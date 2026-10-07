import { randomInt } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { PoolConnection } from "mariadb";
import { requireAuth } from "../auth/middleware.js";
import { pool } from "../db.js";
import { parseId } from "../forms/validation.js";
import {
  checkValue,
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

/**
 * Copies the form's current questions into the submission's snapshot (Issue #36). Call it in
 * the transaction that submits the form, after the template is locked, so the copy is exactly
 * the field set the answers were validated against. The rows are never updated afterwards.
 */
export async function snapshotFields(conn: PoolConnection | typeof pool, submissionId: number) {
  await conn.query(
    `INSERT INTO submission_field_snapshots
       (submission_id, source_field_id, label, field_type, is_required, options, position)
     SELECT s.id, f.id, f.label, f.field_type, f.is_required, f.options,
            ROW_NUMBER() OVER (ORDER BY f.position, f.id)
       FROM form_submissions s
       JOIN form_fields f ON f.form_template_id = s.form_template_id
      WHERE s.id = ?`,
    [submissionId],
  );
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

/**
 * The owner's submission. A submitted form's questions come from its snapshot, so later template
 * edits never change it; a draft follows the current form. `withUnanswered` (detail view) also
 * lists questions of a submitted form that were left empty, since empty answers are not stored.
 */
export async function loadSubmission(
  conn: PoolConnection | typeof pool,
  id: number,
  userId: number,
  { withUnanswered = false } = {},
) {
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
  type AnswerRow = { field_id: number; label: string; field_type: string; answer_value: string | null };
  const answers: AnswerRow[] =
    row.status === "SUBMITTED"
      ? // Matched by the original field id only; the current form_fields row is not needed.
        await conn.query(
          `SELECT q.source_field_id AS field_id, q.label, q.field_type, a.answer_value
             FROM submission_field_snapshots q
             LEFT JOIN form_answers a ON a.submission_id = q.submission_id AND a.field_id = q.source_field_id
            WHERE q.submission_id = ?${withUnanswered ? "" : " AND a.id IS NOT NULL"}
            ORDER BY q.position`,
          [row.id],
        )
      : await conn.query(
          `SELECT a.field_id, f.label, f.field_type, a.answer_value
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
      fieldType: answer.field_type,
      value: answer.answer_value,
    })),
  };
}

/** Submitted forms of `userId`, newest first. Drafts are never included. */
export async function listSubmitted(userId: number) {
  const rows: Pick<SubmissionRow, "id" | "form_template_id" | "form_name" | "status" | "reference_code" | "submitted_at">[] =
    await pool.query(
      `SELECT s.id, s.form_template_id, t.name AS form_name, s.status, s.reference_code, s.submitted_at
         FROM form_submissions s
         JOIN form_templates t ON t.id = s.form_template_id
        WHERE s.user_id = ? AND s.status = 'SUBMITTED'
        ORDER BY s.submitted_at DESC, s.id DESC`,
      [userId],
    );
  return rows.map((row) => ({
    id: row.id,
    formTemplateId: row.form_template_id,
    formName: row.form_name,
    status: row.status,
    referenceCode: row.reference_code,
    submittedAt: row.submitted_at,
  }));
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
    await snapshotFields(conn, id);
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

// The current user's submitted forms, newest first. No query parameters are accepted, so a
// `userId` or similar can never select another owner; the owner comes from the session.
submissionsRouter.get("/", async (req, res) => {
  const unexpected = Object.keys(req.query);
  if (unexpected.length > 0) {
    res.status(400).json({
      error: "Validation failed",
      fields: Object.fromEntries(unexpected.map((key) => [key, "not_allowed"])),
    });
    return;
  }
  res.json({ submissions: await listSubmitted(req.user!.id) });
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

// Only `formTemplateId` is accepted. Anything else (e.g. `userId`) is rejected, so the
// data owner can only ever come from the session.
function parsePreviousDataQuery(query: Record<string, unknown>) {
  const errors: FieldErrors = {};
  for (const key of Object.keys(query)) {
    if (key !== "formTemplateId") errors[key] = "not_allowed";
  }
  const templateId = parseId(query.formTemplateId);
  if (!templateId) errors.formTemplateId = query.formTemplateId === undefined ? "required" : "invalid";
  return { templateId, errors };
}

/**
 * Previous answers for a form, from the user's own latest SUBMITTED submission of the same
 * template. Matched by field id, so only fields of this form are returned. Values are checked
 * against the current field definitions, and ones that are no longer valid (e.g. a removed
 * SELECT option) are left out. Returns null if the form is not published.
 */
async function findPreviousAnswers(userId: number, templateId: number) {
  const templates: { status: string }[] = await pool.query(
    "SELECT status FROM form_templates WHERE id = ?",
    [templateId],
  );
  if (templates[0]?.status !== "PUBLISHED") return null;

  const submissions: { id: number; submitted_at: Date }[] = await pool.query(
    `SELECT id, submitted_at FROM form_submissions
      WHERE user_id = ? AND form_template_id = ? AND status = 'SUBMITTED'
      ORDER BY submitted_at DESC, id DESC
      LIMIT 1`,
    [userId, templateId],
  );
  const latest = submissions[0];
  if (!latest) return { submittedAt: null, answers: [] as Answer[] };

  const rows: (FieldRow & { answer_value: string | null })[] = await pool.query(
    `SELECT f.id, f.label, f.description, f.field_type, f.is_required, f.position, f.options,
            a.answer_value
       FROM form_answers a
       JOIN form_fields f ON f.id = a.field_id AND f.form_template_id = ?
      WHERE a.submission_id = ?
      ORDER BY f.position, f.id`,
    [templateId, latest.id],
  );
  const answers: Answer[] = [];
  for (const row of rows) {
    const value = row.answer_value?.trim();
    if (!value) continue;
    const result = checkValue(toField(row), value);
    if ("value" in result) answers.push({ fieldId: row.id, value: result.value });
  }
  return { submittedAt: answers.length > 0 ? latest.submitted_at : null, answers };
}

// Sends the error response itself and returns undefined when the request cannot be served.
async function previousDataFor(req: Request, res: Response) {
  const { templateId, errors } = parsePreviousDataQuery(req.query);
  if (!templateId || Object.keys(errors).length > 0) {
    res.status(400).json({ error: "Validation failed", fields: errors });
    return undefined;
  }
  const previous = await findPreviousAnswers(req.user!.id, templateId);
  // Same 404 for missing and unpublished forms, like everywhere else.
  if (!previous) res.status(404).json({ error: "Not found" });
  return previous ?? undefined;
}

// Tells the form whether to offer prefill, without returning any values before consent.
submissionsRouter.get("/previous-data/available", async (req, res) => {
  const previous = await previousDataFor(req, res);
  if (!previous) return;
  res.json({ available: previous.answers.length > 0, fieldCount: previous.answers.length });
});

// The values themselves. The UI calls this only after the user has chosen to use them.
submissionsRouter.get("/previous-data", async (req, res) => {
  const previous = await previousDataFor(req, res);
  if (previous) res.json({ previousData: previous });
});

// Owner only. Other users get 404 so submission ids cannot be probed.
submissionsRouter.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const submission = id ? await loadSubmission(pool, id, req.user!.id, { withUnanswered: true }) : undefined;
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

    await snapshotFields(conn, id);
    await conn.query(
      "UPDATE form_submissions SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id],
    );
    const submission = await loadSubmission(conn, id, userId);
    return { status: 200, commit: true, body: { submission } };
  });
  res.status(outcome.status).json(outcome.body);
});
