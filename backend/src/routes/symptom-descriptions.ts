import { Router, type Request, type Response } from "express";
import { requireRole } from "../auth/middleware.js";
import { pool } from "../db.js";
import { validateSymptomDescription } from "../symptoms/validation.js";

export const symptomDescriptionsRouter = Router();

// Customers only. The routes never take a user id: the owner is always the session user, so
// ADMIN and PROFESSIONAL cannot read customers' descriptions through them. Professional access
// is a separate, controlled feature. Description text is never logged.
symptomDescriptionsRouter.use(requireRole("USER"));

type DescriptionRow = { id: number; description: string; created_at: Date };

function toDescription(row: DescriptionRow) {
  return { id: row.id, description: row.description, createdAt: row.created_at };
}

// No query parameters are accepted, so a `userId` or similar can never select another owner.
function rejectQuery(req: Request, res: Response): boolean {
  const unexpected = Object.keys(req.query);
  if (unexpected.length === 0) return false;
  res.status(400).json({
    error: "Validation failed",
    fields: Object.fromEntries(unexpected.map((key) => [key, "not_allowed"])),
  });
  return true;
}

symptomDescriptionsRouter.get("/", async (req, res) => {
  if (rejectQuery(req, res)) return;
  const rows: DescriptionRow[] = await pool.query(
    `SELECT id, description, created_at FROM symptom_descriptions
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC`,
    [req.user!.id],
  );
  res.json({ symptomDescriptions: rows.map(toDescription) });
});

symptomDescriptionsRouter.post("/", async (req, res) => {
  if (rejectQuery(req, res)) return;
  const result = validateSymptomDescription(req.body);
  if (!result.ok) {
    res.status(400).json({ error: "Validation failed", fields: result.errors });
    return;
  }
  const inserted = await pool.query("INSERT INTO symptom_descriptions (user_id, description) VALUES (?, ?)", [
    req.user!.id,
    result.description,
  ]);
  const [row]: DescriptionRow[] = await pool.query(
    "SELECT id, description, created_at FROM symptom_descriptions WHERE id = ? AND user_id = ?",
    [inserted.insertId, req.user!.id],
  );
  res.status(201).json({ symptomDescription: toDescription(row) });
});
