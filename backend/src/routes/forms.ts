import { Router, type Response } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { pool } from "../db.js";
import {
  parseId,
  validateField,
  validateFieldOrder,
  validateTemplate,
  type FieldErrors,
  type FieldInput,
  type FieldType,
} from "../forms/validation.js";

export const formsRouter = Router();

type TemplateStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

type TemplateRow = {
  id: number;
  name: string;
  description: string | null;
  status: TemplateStatus;
  created_at: Date;
  updated_at: Date;
};

type FieldRow = {
  id: number;
  label: string;
  description: string | null;
  field_type: FieldType;
  is_required: number;
  position: number;
  options: string[] | string | null;
};

const TEMPLATE_COLUMNS = "id, name, description, status, created_at, updated_at";
const FIELD_COLUMNS = "id, label, description, field_type, is_required, position, options";

function toTemplate(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toField(row: FieldRow) {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    fieldType: row.field_type,
    required: Boolean(row.is_required),
    position: row.position,
    // The driver may return a JSON column either parsed or as text.
    options: typeof row.options === "string" ? (JSON.parse(row.options) as string[]) : row.options,
  };
}

function validationError(res: Response, fields: FieldErrors) {
  res.status(400).json({ error: "Validation failed", fields });
}

function notFound(res: Response) {
  res.status(404).json({ error: "Not found" });
}

async function findTemplate(id: number): Promise<TemplateRow | undefined> {
  const rows: TemplateRow[] = await pool.query(
    `SELECT ${TEMPLATE_COLUMNS} FROM form_templates WHERE id = ?`,
    [id],
  );
  return rows[0];
}

async function findFields(templateId: number): Promise<FieldRow[]> {
  // id breaks ties so the order is stable even if positions ever collide.
  return pool.query(
    `SELECT ${FIELD_COLUMNS} FROM form_fields WHERE form_template_id = ? ORDER BY position, id`,
    [templateId],
  );
}

// Structure can only change while the template is a draft, so users never see a published form
// change under them. Sends the error response and returns null if the template is not editable.
async function findEditableTemplate(rawId: unknown, res: Response): Promise<TemplateRow | null> {
  const id = parseId(rawId);
  const template = id ? await findTemplate(id) : undefined;
  if (!template) {
    notFound(res);
    return null;
  }
  if (template.status !== "DRAFT") {
    res.status(409).json({ error: "Template must be unpublished before editing" });
    return null;
  }
  return template;
}

async function sendTemplateWithFields(res: Response, templateId: number, status = 200) {
  const template = (await findTemplate(templateId))!;
  const fields = await findFields(templateId);
  res.status(status).json({ template: { ...toTemplate(template), fields: fields.map(toField) } });
}

formsRouter.use(requireAuth);

// ADMIN sees every template; other roles see only published ones.
formsRouter.get("/", async (req, res) => {
  const isAdmin = req.user!.role === "ADMIN";
  const rows: (TemplateRow & { field_count: bigint })[] = await pool.query(
    `SELECT t.id, t.name, t.description, t.status, t.created_at, t.updated_at,
            (SELECT COUNT(*) FROM form_fields f WHERE f.form_template_id = t.id) AS field_count
       FROM form_templates t
      ${isAdmin ? "" : "WHERE t.status = 'PUBLISHED'"}
      ORDER BY t.updated_at DESC, t.id DESC`,
  );
  res.json({
    templates: rows.map((row) => ({ ...toTemplate(row), fieldCount: Number(row.field_count) })),
  });
});

formsRouter.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const template = id ? await findTemplate(id) : undefined;
  // 404 rather than 403 so non-admins cannot probe for unpublished templates.
  if (!template || (template.status !== "PUBLISHED" && req.user!.role !== "ADMIN")) {
    notFound(res);
    return;
  }
  await sendTemplateWithFields(res, template.id);
});

formsRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const { value, errors } = validateTemplate(req.body);
  if (Object.keys(errors).length > 0) {
    validationError(res, errors);
    return;
  }
  const result = await pool.query(
    "INSERT INTO form_templates (name, description, status) VALUES (?, ?, 'DRAFT')",
    [value.name, value.description],
  );
  await sendTemplateWithFields(res, Number(result.insertId), 201);
});

formsRouter.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const template = await findEditableTemplate(req.params.id, res);
  if (!template) return;
  const { value, errors } = validateTemplate(req.body, template);
  if (Object.keys(errors).length > 0) {
    validationError(res, errors);
    return;
  }
  await pool.query("UPDATE form_templates SET name = ?, description = ? WHERE id = ?", [
    value.name,
    value.description,
    template.id,
  ]);
  await sendTemplateWithFields(res, template.id);
});

formsRouter.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  const template = await findEditableTemplate(req.params.id, res);
  if (!template) return;
  try {
    // Fields are removed by ON DELETE CASCADE.
    await pool.query("DELETE FROM form_templates WHERE id = ?", [template.id]);
  } catch (err) {
    // Templates with submissions are protected by ON DELETE RESTRICT.
    if ((err as { code?: string }).code === "ER_ROW_IS_REFERENCED_2") {
      res.status(409).json({ error: "Template has submissions and cannot be deleted" });
      return;
    }
    throw err;
  }
  res.status(204).end();
});

formsRouter.post("/:id/publish", requireRole("ADMIN"), async (req, res) => {
  const id = parseId(req.params.id);
  const template = id ? await findTemplate(id) : undefined;
  if (!template) {
    notFound(res);
    return;
  }
  if ((await findFields(template.id)).length === 0) {
    res.status(409).json({ error: "Template must have at least one field" });
    return;
  }
  await pool.query("UPDATE form_templates SET status = 'PUBLISHED' WHERE id = ?", [template.id]);
  await sendTemplateWithFields(res, template.id);
});

formsRouter.post("/:id/unpublish", requireRole("ADMIN"), async (req, res) => {
  const id = parseId(req.params.id);
  const template = id ? await findTemplate(id) : undefined;
  if (!template) {
    notFound(res);
    return;
  }
  await pool.query("UPDATE form_templates SET status = 'DRAFT' WHERE id = ?", [template.id]);
  await sendTemplateWithFields(res, template.id);
});

formsRouter.post("/:id/fields", requireRole("ADMIN"), async (req, res) => {
  const template = await findEditableTemplate(req.params.id, res);
  if (!template) return;
  const { value, errors } = validateField(req.body);
  if (Object.keys(errors).length > 0) {
    validationError(res, errors);
    return;
  }
  // New fields go last; INSERT ... SELECT computes the position in the same statement.
  await pool.query(
    `INSERT INTO form_fields
       (form_template_id, label, description, field_type, is_required, options, position)
     SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(position), 0) + 1
       FROM form_fields WHERE form_template_id = ?`,
    [
      template.id,
      value.label,
      value.description,
      value.fieldType,
      value.required,
      value.options ? JSON.stringify(value.options) : null,
      template.id,
    ],
  );
  await sendTemplateWithFields(res, template.id, 201);
});

// Fixed path registered before "/:id/fields/:fieldId" so "order" is never parsed as a field id.
formsRouter.put("/:id/fields/order", requireRole("ADMIN"), async (req, res) => {
  const template = await findEditableTemplate(req.params.id, res);
  if (!template) return;
  const fields = await findFields(template.id);
  const order = validateFieldOrder(req.body, fields.map((field) => field.id));
  if (!order) {
    validationError(res, { fieldIds: "invalid" });
    return;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const [index, fieldId] of order.entries()) {
      await conn.query(
        "UPDATE form_fields SET position = ? WHERE id = ? AND form_template_id = ?",
        [index + 1, fieldId, template.id],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await sendTemplateWithFields(res, template.id);
});

async function findField(templateId: number, rawFieldId: unknown): Promise<FieldRow | undefined> {
  const fieldId = parseId(rawFieldId);
  if (!fieldId) return undefined;
  const rows: FieldRow[] = await pool.query(
    `SELECT ${FIELD_COLUMNS} FROM form_fields WHERE id = ? AND form_template_id = ?`,
    [fieldId, templateId],
  );
  return rows[0];
}

formsRouter.patch("/:id/fields/:fieldId", requireRole("ADMIN"), async (req, res) => {
  const template = await findEditableTemplate(req.params.id, res);
  if (!template) return;
  const row = await findField(template.id, req.params.fieldId);
  if (!row) {
    notFound(res);
    return;
  }
  const current = toField(row) satisfies FieldInput;
  const { value, errors } = validateField(req.body, current);
  if (Object.keys(errors).length > 0) {
    validationError(res, errors);
    return;
  }
  await pool.query(
    `UPDATE form_fields
        SET label = ?, description = ?, field_type = ?, is_required = ?, options = ?
      WHERE id = ?`,
    [
      value.label,
      value.description,
      value.fieldType,
      value.required,
      value.options ? JSON.stringify(value.options) : null,
      row.id,
    ],
  );
  await sendTemplateWithFields(res, template.id);
});

formsRouter.delete("/:id/fields/:fieldId", requireRole("ADMIN"), async (req, res) => {
  const template = await findEditableTemplate(req.params.id, res);
  if (!template) return;
  const row = await findField(template.id, req.params.fieldId);
  if (!row) {
    notFound(res);
    return;
  }
  try {
    await pool.query("DELETE FROM form_fields WHERE id = ?", [row.id]);
  } catch (err) {
    // Fields with saved answers are protected by ON DELETE RESTRICT.
    if ((err as { code?: string }).code === "ER_ROW_IS_REFERENCED_2") {
      res.status(409).json({ error: "Field has answers and cannot be deleted" });
      return;
    }
    throw err;
  }
  await sendTemplateWithFields(res, template.id);
});
