// Backfill in migration 007 (Issue #36), run against the configured MariaDB with the SQL read
// from the migration file itself. The backend container only sees backend/, so this file is
// skipped there; run it from the host (see 09 Testing). The backfill only adds snapshots for
// SUBMITTED rows that have none, so running it here does not change other data's snapshots.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pool } from "../src/db.js";
import { loadSubmission, snapshotFields } from "../src/routes/submissions.js";

const MIGRATION = join(import.meta.dirname, "../../database/init/007_submission_field_snapshots.sql");
const skip = existsSync(MIGRATION) ? false : "migration file not visible (run from the host)";

let backfill: string;
let userId: number;
let templateId: number;
const fieldIds: number[] = [];
const ids: Record<string, number> = {};

async function insertSubmission(status: "DRAFT" | "SUBMITTED", submittedAt: string | null) {
  const result = await pool.query(
    `INSERT INTO form_submissions (user_id, form_template_id, status, reference_code, submitted_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, templateId, status, `LA-B${randomUUID().slice(0, 8).toUpperCase()}`, submittedAt],
  );
  return Number(result.insertId);
}

async function snapshot(submissionId: number) {
  const rows: { source_field_id: number; label: string; position: number }[] = await pool.query(
    "SELECT source_field_id, label, position FROM submission_field_snapshots WHERE submission_id = ? ORDER BY position",
    [submissionId],
  );
  return rows.map((row) => [row.source_field_id, row.label, row.position]);
}

before(async () => {
  if (skip) return;
  const sql = readFileSync(MIGRATION, "utf8");
  backfill = sql.slice(sql.indexOf("INSERT INTO submission_field_snapshots"));

  const user = await pool.query("INSERT INTO users (email, password_hash) VALUES (?, 'x')", [
    `backfill-test-${randomUUID()}@example.test`,
  ]);
  userId = Number(user.insertId);
  const template = await pool.query("INSERT INTO form_templates (name, status) VALUES (?, 'PUBLISHED')", [
    `Backfill-testi ${randomUUID()}`,
  ]);
  templateId = Number(template.insertId);
  // Positions out of id order, and the last field added after the legacy submissions.
  for (const [label, position, createdAt] of [
    ["Ensimmäinen", 2, "2026-01-01 10:00:00"],
    ["Toinen", 1, "2026-01-01 10:00:00"],
    ["Myöhemmin lisätty", 3, "2026-06-01 10:00:00"],
  ] as const) {
    const field = await pool.query(
      "INSERT INTO form_fields (form_template_id, label, field_type, position, created_at) VALUES (?, ?, 'TEXT', ?, ?)",
      [templateId, label, position, createdAt],
    );
    fieldIds.push(Number(field.insertId));
  }

  // Submitted before snapshots existed: no snapshot rows.
  ids.answered = await insertSubmission("SUBMITTED", "2026-03-01 10:00:00");
  await pool.query("INSERT INTO form_answers (submission_id, field_id, answer_value) VALUES (?, ?, 'vanha')", [
    ids.answered,
    fieldIds[0],
  ]);
  ids.empty = await insertSubmission("SUBMITTED", "2026-03-02 10:00:00");
  ids.draft = await insertSubmission("DRAFT", null);
  // Already has an exact snapshot, as a new submission would.
  ids.current = await insertSubmission("SUBMITTED", "2026-07-01 10:00:00");
  await snapshotFields(pool, ids.current);
});

after(async () => {
  if (!skip) {
    await pool.query("DELETE FROM users WHERE id = ?", [userId]);
    await pool.query("DELETE FROM form_templates WHERE id = ?", [templateId]);
  }
  await pool.end();
});

test("backfill snapshots legacy submissions, skips drafts and existing snapshots, and is repeatable", { skip }, async () => {
  const currentBefore = await snapshot(ids.current);
  assert.equal(currentBefore.length, 3);

  await pool.query(backfill);
  // Form order by position; the field added after submission is left out, like the old display rule.
  const expected = [
    [fieldIds[1], "Toinen", 1],
    [fieldIds[0], "Ensimmäinen", 2],
  ];
  assert.deepEqual(await snapshot(ids.answered), expected);
  assert.deepEqual(await snapshot(ids.empty), expected);
  assert.deepEqual(await snapshot(ids.draft), []);
  assert.deepEqual(await snapshot(ids.current), currentBefore);

  await pool.query(backfill);
  assert.deepEqual(await snapshot(ids.answered), expected);
  assert.deepEqual(await snapshot(ids.empty), expected);
  assert.deepEqual(await snapshot(ids.current), currentBefore);

  // Readable through the shared loader, including the submission without answers.
  const answered = await loadSubmission(pool, ids.answered, userId, { withUnanswered: true });
  assert.deepEqual(
    answered!.answers.map((a) => [a.label, a.value]),
    [
      ["Toinen", null],
      ["Ensimmäinen", "vanha"],
    ],
  );
  const empty = await loadSubmission(pool, ids.empty, userId, { withUnanswered: true });
  assert.deepEqual(empty!.answers.map((a) => a.value), [null, null]);
});
