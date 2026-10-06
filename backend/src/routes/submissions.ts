import { randomInt } from "node:crypto";
import { Router } from "express";
import type { PoolConnection } from "mariadb";
import { requireAuth } from "../auth/middleware.js";
import { pool } from "../db.js";
import { parseId } from "../forms/validation.js";
import {
  validateAnswers,
  validateDraftAnswers,
  type Answer,
  type FieldDefinition,
  type FieldErrors,
} from "../submissions/answers.js";
import { FIELD_COLUMNS, toField, type FieldRow } from "./forms.js";

export const submissionsRouter = Router();

type SubmissionStatus = "DRAFT" | "SUBMITTED";

// No 0/O or 1/I, so codes are easy to read aloud and type.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 5;

function newReferenceCode(): string {
  let code = "LA-";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

type Outcome = { status: number; body: unknown; commit?: boolean };

const notFound: Outcome = { status: 404, body: { error: "Not found" } };
const alreadySubmitted: Outcome = { status: 409, body: { error: "Submission is already submitted" } };
const notPublished: Outcome = { status: 409, body: { error: "Form is not published" } };

function validationFailed(fields: FieldErrors): Outcome {
  return { status: 400, body: { error: "Validation failed", fields } };
}

// Runs the work in one transaction. Only outcomes marked `commit` are committed, so a
// validation failure never leaves partial changes behind.
async function transact(work: (conn: PoolConnection) => Promise<Outcome>): Promise<Outcome> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const outcome = await work(conn);
    if (outcome.commit) await conn.commit();
    else await conn.rollback();
    return outcome;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function readBody(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

// The shared lock keeps the template from being unpublished or edited mid-request.
// Returns null if the template does not exist or is not published.
async function lockPublishedFields(
  conn: PoolConnection,
  templateId: number,
): Promise<FieldDefinition[] | null> {
  const templates: { status: string }[] = await conn.query(
    "SELECT status FROM form_templates WHERE id = ? LOCK IN SHARE MODE",
    [templateId],
  );
  if (templates[0]?.status !== "PUBLISHED") return null;
  const rows: FieldRow[] = await conn.query(
    `SELECT ${FIELD_COLUMNS} FROM form_fields WHERE form_template_id = ? ORDER BY position, id`,
    [templateId],
  );
  return rows.map(toField);
}

// Only the owner's rows are ever found, so other users get the same 404 as a missing id.
async function lockOwnSubmission(conn: PoolConnection, id: number, userId: number) {
  const rows: { id: number; form_template_id: number; status: SubmissionStatus }[] =
    await conn.query(
      "SELECT id, form_template_id, status FROM form_submissions WHERE id = ? AND user_id = ? FOR UPDATE",
      [id, userId],
    );
  return rows[0];
}

// Retries on the rare collision with an existing code (unique key). Drafts get a code too,
// because the column is required, but it is only shown once the form is submitted.
async function insertSubmission(
  conn: PoolConnection,
  userId: number,
  templateId: number,
  status: SubmissionStatus,
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await conn.query(
        `INSERT INTO form_submissions (user_id, form_template_id, status, reference_code, submitted_at)
         VALUES (?, ?, ?, ?, ${status === "SUBMITTED" ? "CURRENT_TIMESTAMP" : "NULL"})`,
        [userId, templateId, status, newReferenceCode()],
      );
      return Number(result.insertId);
    } catch (err) {
      if ((err as { code?: string }).code !== "ER_DUP_ENTRY" || attempt >= CODE_ATTEMPTS) throw err;
    }
  }
}

// Upsert on the (submission_id, field_id) unique key, so a field never gets a second answer.
async function saveAnswers(
  conn: PoolConnection,
  submissionId: number,
  answers: Answer[],
  cleared: number[] = [],
) {
  if (answers.length > 0) {
    await conn.batch(
      `INSERT INTO form_answers (submission_id, field_id, answer_value) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE answer_value = VALUES(answer_value)`,
      answers.map((answer) => [submissionId, answer.fieldId, answer.value]),
    );
  }
  if (cleared.length > 0) {
    await conn.query("DELETE FROM form_answers WHERE submission_id = ? AND field_id IN (?)", [
      submissionId,
      cleared,
    ]);
  }
}

type SubmissionRow = {
  id: number;
  form_template_id: number;
  form_name: string;
  form_status: string;
  status: SubmissionStatus;
  reference_code: string;
  created_at: Date;
  updated_at: Date;
  submitted_at: Date | null;
};

async function loadSubmission(conn: PoolConnection | typeof pool, id: number, userId: number) {
  const rows: SubmissionRow[] = await conn.query(
    `SELECT s.id, s.form_template_id, t.name AS form_name, t.status AS form_status, s.status,
            s.reference_code, s.created_at, s.updated_at, s.submitted_at
       FROM form_submissions s
       JOIN form_templates t ON t.id = s.form_template_id
      WHERE s.id = ? AND s.user_id = ?`,
    [id, userId],
  );
  const row = rows[0];
  if (!row) return undefined;
  const answers: { field_id: number; label: string; answer_value: string | null }[] =
    await conn.query(
      `SELECT a.field_id, f.label, a.answer_value
         FROM form_answers a
         JOIN form_fields f ON f.id = a.field_id
        WHERE a.submission_id = ?
        ORDER BY f.position, f.id`,
      [row.id],
    );
  return {
    id: row.id,
    formTemplateId: row.form_template_id,
    formName: row.form_name,
    // A draft can only be continued while its form is published.
    formAvailable: row.form_status === "PUBLISHED",
    status: row.status,
    // Drafts have a code in the database, but it is not a receipt until the form is submitted.
    referenceCode: row.status === "SUBMITTED" ? row.reference_code : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    answers: answers.map((answer) => ({
      fieldId: answer.field_id,
      label: answer.label,
      value: answer.answer_value,
    })),
  };
}

submissionsRouter.use(requireAuth);

// Submits a published form in one step, without a draft.
submissionsRouter.post("/", async (req, res) => {
  const body = readBody(req.body);
  const templateId = body.formTemplateId;
  if (!isId(templateId)) {
    res.status(400).json({
      error: "Validation failed",
      fields: { formTemplateId: templateId === undefined ? "required" : "invalid" },
    });
    return;
  }

  const outcome = await transact(async (conn) => {
    const fields = await lockPublishedFields(conn, templateId);
    // Same 404 for missing and unpublished, for every role, so drafts cannot be probed.
    if (!fields) return notFound;
    const { answers, errors } = validateAnswers(body.answers, fields);
    if (Object.keys(errors).length > 0) return validationFailed(errors);

    const id = await insertSubmission(conn, req.user!.id, templateId, "SUBMITTED");
    await saveAnswers(conn, id, answers);
    const saved = (await loadSubmission(conn, id, req.user!.id))!;
    return {
      status: 201,
      commit: true,
      body: {
        submission: {
          id,
          formTemplateId: templateId,
          referenceCode: saved.referenceCode,
          status: saved.status,
          submittedAt: saved.submittedAt,
        },
      },
    };
  });
  res.status(outcome.status).json(outcome.body);
});

// `{ formTemplateId, answers }` creates a draft; `{ id, answers }` updates the user's own draft.
// Answers are merged: sent keys are saved, empty values clear an answer, other answers stay.
submissionsRouter.post("/draft", async (req, res) => {
  const body = readBody(req.body);
  const userId = req.user!.id;

  if (body.id !== undefined && !isId(body.id)) {
    res.status(400).json({ error: "Validation failed", fields: { id: "invalid" } });
    return;
  }
  if (body.id === undefined && !isId(body.formTemplateId)) {
    res.status(400).json({
      error: "Validation failed",
      fields: { formTemplateId: body.formTemplateId === undefined ? "required" : "invalid" },
    });
    return;
  }

  const outcome = await transact(async (conn) => {
    let draftId: number | undefined;
    let templateId: number;

    if (isId(body.id)) {
      const existing = await lockOwnSubmission(conn, body.id, userId);
      if (!existing) return notFound;
      if (existing.status !== "DRAFT") return alreadySubmitted;
      if (body.formTemplateId !== undefined && body.formTemplateId !== existing.form_template_id) {
        return validationFailed({ formTemplateId: "invalid" });
      }
      draftId = existing.id;
      templateId = existing.form_template_id;
    } else {
      templateId = body.formTemplateId as number;
    }

    const fields = await lockPublishedFields(conn, templateId);
    // A new draft needs a visible form (404 like everywhere else). An existing draft is kept,
    // but cannot change while its form is unpublished.
    if (!fields) return draftId ? notPublished : notFound;

    const { answers, cleared, errors } = validateDraftAnswers(body.answers, fields);
    if (Object.keys(errors).length > 0) return validationFailed(errors);

    const created = !draftId;
    if (!draftId) {
      draftId = await insertSubmission(conn, userId, templateId, "DRAFT");
    } else {
      // Answer changes do not touch the submission row, so record the save time explicitly.
      await conn.query("UPDATE form_submissions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
        draftId,
      ]);
    }
    await saveAnswers(conn, draftId, answers, cleared);
    const submission = await loadSubmission(conn, draftId, userId);
    return { status: created ? 201 : 200, commit: true, body: { submission } };
  });
  res.status(outcome.status).json(outcome.body);
});

// The current user's drafts only. Registered before "/:id" so "drafts" is not parsed as an id.
submissionsRouter.get("/drafts", async (req, res) => {
  const rows: (Omit<SubmissionRow, "status" | "reference_code" | "submitted_at"> & {
    answer_count: bigint;
  })[] = await pool.query(
    `SELECT s.id, s.form_template_id, t.name AS form_name, t.status AS form_status,
            s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM form_answers a WHERE a.submission_id = s.id) AS answer_count
       FROM form_submissions s
       JOIN form_templates t ON t.id = s.form_template_id
      WHERE s.user_id = ? AND s.status = 'DRAFT'
      ORDER BY s.updated_at DESC, s.id DESC`,
    [req.user!.id],
  );
  res.json({
    drafts: rows.map((row) => ({
      id: row.id,
      formTemplateId: row.form_template_id,
      formName: row.form_name,
      formAvailable: row.form_status === "PUBLISHED",
      answerCount: Number(row.answer_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

// Owner only. Other users get 404 so submission ids cannot be probed.
submissionsRouter.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const submission = id ? await loadSubmission(pool, id, req.user!.id) : undefined;
  if (!submission) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ submission });
});

// Final submit of a draft. Optional `answers` are merged first, then the whole draft is
// validated like a one-step submission. Any error rolls everything back, so it stays a DRAFT.
submissionsRouter.post("/:id/submit", async (req, res) => {
  const id = parseId(req.params.id);
  const body = readBody(req.body);
  const userId = req.user!.id;
  if (!id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const outcome = await transact(async (conn) => {
    const draft = await lockOwnSubmission(conn, id, userId);
    if (!draft) return notFound;
    if (draft.status !== "DRAFT") return alreadySubmitted;
    const fields = await lockPublishedFields(conn, draft.form_template_id);
    if (!fields) return notPublished;

    const update = validateDraftAnswers(body.answers, fields);
    if (Object.keys(update.errors).length > 0) return validationFailed(update.errors);
    await saveAnswers(conn, id, update.answers, update.cleared);

    const stored: { field_id: number; answer_value: string | null }[] = await conn.query(
      "SELECT field_id, answer_value FROM form_answers WHERE submission_id = ?",
      [id],
    );
    const all = Object.fromEntries(stored.map((row) => [String(row.field_id), row.answer_value]));
    const { errors } = validateAnswers(all, fields);
    if (Object.keys(errors).length > 0) return validationFailed(errors);

    await conn.query(
      "UPDATE form_submissions SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id],
    );
    const submission = await loadSubmission(conn, id, userId);
    return { status: 200, commit: true, body: { submission } };
  });
  res.status(outcome.status).json(outcome.body);
});
