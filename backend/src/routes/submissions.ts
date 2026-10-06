import { randomInt } from "node:crypto";
import { Router } from "express";
import type { PoolConnection } from "mariadb";
import { requireAuth } from "../auth/middleware.js";
import { pool } from "../db.js";
import { parseId } from "../forms/validation.js";
import { validateAnswers, type Answer } from "../submissions/answers.js";
import { FIELD_COLUMNS, toField, type FieldRow } from "./forms.js";

export const submissionsRouter = Router();

// No 0/O or 1/I, so codes are easy to read aloud and type.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 5;

function newReferenceCode(): string {
  let code = "LA-";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

// Retries on the rare collision with an existing code (unique key).
async function insertSubmission(
  conn: PoolConnection,
  userId: number,
  templateId: number,
): Promise<{ id: number; referenceCode: string }> {
  for (let attempt = 1; ; attempt++) {
    const referenceCode = newReferenceCode();
    try {
      const result = await conn.query(
        `INSERT INTO form_submissions (user_id, form_template_id, status, reference_code, submitted_at)
         VALUES (?, ?, 'SUBMITTED', ?, CURRENT_TIMESTAMP)`,
        [userId, templateId, referenceCode],
      );
      return { id: Number(result.insertId), referenceCode };
    } catch (err) {
      if ((err as { code?: string }).code !== "ER_DUP_ENTRY" || attempt >= CODE_ATTEMPTS) throw err;
    }
  }
}

async function insertAnswers(conn: PoolConnection, submissionId: number, answers: Answer[]) {
  if (answers.length === 0) return;
  await conn.batch(
    "INSERT INTO form_answers (submission_id, field_id, answer_value) VALUES (?, ?, ?)",
    answers.map((answer) => [submissionId, answer.fieldId, answer.value]),
  );
}

submissionsRouter.use(requireAuth);

// Submits a published form in one step. Draft saving is a separate feature.
submissionsRouter.post("/", async (req, res) => {
  const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<
    string,
    unknown
  >;
  const templateId = body.formTemplateId;
  if (typeof templateId !== "number" || !Number.isInteger(templateId) || templateId < 1) {
    res.status(400).json({
      error: "Validation failed",
      fields: { formTemplateId: templateId === undefined ? "required" : "invalid" },
    });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // The shared lock keeps the template from being unpublished or edited mid-submission.
    const templates: { status: string }[] = await conn.query(
      "SELECT status FROM form_templates WHERE id = ? LOCK IN SHARE MODE",
      [templateId],
    );
    // Same 404 for missing and unpublished, for every role, so drafts cannot be probed.
    if (templates[0]?.status !== "PUBLISHED") {
      await conn.rollback();
      res.status(404).json({ error: "Not found" });
      return;
    }

    const rows: FieldRow[] = await conn.query(
      `SELECT ${FIELD_COLUMNS} FROM form_fields WHERE form_template_id = ? ORDER BY position, id`,
      [templateId],
    );
    const { answers, errors } = validateAnswers(body.answers, rows.map(toField));
    if (Object.keys(errors).length > 0) {
      await conn.rollback();
      res.status(400).json({ error: "Validation failed", fields: errors });
      return;
    }

    const submission = await insertSubmission(conn, req.user!.id, templateId);
    await insertAnswers(conn, submission.id, answers);
    await conn.commit();

    const [saved] = await pool.query(
      "SELECT status, submitted_at FROM form_submissions WHERE id = ?",
      [submission.id],
    );
    res.status(201).json({
      submission: {
        id: submission.id,
        formTemplateId: templateId,
        referenceCode: submission.referenceCode,
        status: saved.status,
        submittedAt: saved.submitted_at,
      },
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Owner only. Other users get 404 so submission ids cannot be probed.
submissionsRouter.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const rows = id
    ? await pool.query(
        `SELECT s.id, s.form_template_id, t.name AS form_name, s.status, s.reference_code,
                s.created_at, s.submitted_at
           FROM form_submissions s
           JOIN form_templates t ON t.id = s.form_template_id
          WHERE s.id = ? AND s.user_id = ?`,
        [id, req.user!.id],
      )
    : [];
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const answers: { field_id: number; label: string; answer_value: string | null }[] =
    await pool.query(
      `SELECT a.field_id, f.label, a.answer_value
         FROM form_answers a
         JOIN form_fields f ON f.id = a.field_id
        WHERE a.submission_id = ?
        ORDER BY f.position, f.id`,
      [row.id],
    );
  res.json({
    submission: {
      id: row.id,
      formTemplateId: row.form_template_id,
      formName: row.form_name,
      referenceCode: row.reference_code,
      status: row.status,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      answers: answers.map((answer) => ({
        fieldId: answer.field_id,
        label: answer.label,
        value: answer.answer_value,
      })),
    },
  });
});
