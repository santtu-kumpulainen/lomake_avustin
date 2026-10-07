import { Router, type Request, type Response } from "express";
import { requireRole } from "../auth/middleware.js";
import { pool } from "../db.js";
import { parseId } from "../forms/validation.js";

export const adminRouter = Router();

// ADMIN is the only authority that creates or removes professional -> customer assignments
// (Issue #32). Professionals cannot assign themselves, and customers never see assignments.
adminRouter.use(requireRole("ADMIN"));

const ASSIGNMENTS = "/professional-customers";

type FieldErrors = Record<string, string>;

function validationFailed(res: Response, fields: FieldErrors) {
  res.status(400).json({ error: "Validation failed", fields });
}

function rejectQuery(req: Request, res: Response): boolean {
  const unexpected = Object.keys(req.query);
  if (unexpected.length === 0) return false;
  validationFailed(res, Object.fromEntries(unexpected.map((key) => [key, "not_allowed"])));
  return true;
}

type AssignmentRow = {
  id: number;
  created_at: Date;
  professional_id: number;
  professional_email: string;
  customer_id: number;
  customer_email: string;
  first_name: string | null;
  last_name: string | null;
};

adminRouter.get(ASSIGNMENTS, async (req, res) => {
  if (rejectQuery(req, res)) return;
  const rows: AssignmentRow[] = await pool.query(
    `SELECT a.id, a.created_at, p.id AS professional_id, p.email AS professional_email,
            c.id AS customer_id, c.email AS customer_email, pr.first_name, pr.last_name
       FROM professional_customer_access a
       JOIN users p ON p.id = a.professional_user_id
       JOIN users c ON c.id = a.customer_user_id
       LEFT JOIN user_profiles pr ON pr.user_id = c.id
      ORDER BY p.email, pr.last_name IS NULL, pr.last_name, pr.first_name, c.email, a.id`,
  );
  res.json({
    assignments: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      professional: { id: row.professional_id, email: row.professional_email },
      customer: {
        id: row.customer_id,
        email: row.customer_email,
        firstName: row.first_name,
        lastName: row.last_name,
      },
    })),
  });
});

// Accounts that can be assigned, for the admin selectors. Only the correct roles are listed.
adminRouter.get(`${ASSIGNMENTS}/options`, async (req, res) => {
  if (rejectQuery(req, res)) return;
  const professionals: { id: number; email: string }[] = await pool.query(
    "SELECT id, email FROM users WHERE role = 'PROFESSIONAL' ORDER BY email",
  );
  const customers: { id: number; email: string; first_name: string | null; last_name: string | null }[] =
    await pool.query(
      `SELECT u.id, u.email, p.first_name, p.last_name
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.role = 'USER'
        ORDER BY p.last_name IS NULL, p.last_name, p.first_name, u.email`,
    );
  res.json({
    professionals: professionals.map((row) => ({ id: row.id, email: row.email })),
    customers: customers.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
    })),
  });
});

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4294967295;
}

// Body `{ professionalId, customerId }`. Both accounts are looked up here and must have the
// right role in the database; nothing about roles is taken from the request.
adminRouter.post(ASSIGNMENTS, async (req, res) => {
  if (rejectQuery(req, res)) return;
  const body: Record<string, unknown> =
    typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? req.body : {};

  const errors: FieldErrors = {};
  for (const key of Object.keys(body)) {
    if (key !== "professionalId" && key !== "customerId") errors[key] = "not_allowed";
  }
  for (const key of ["professionalId", "customerId"] as const) {
    if (body[key] === undefined || body[key] === null) errors[key] = "required";
    else if (!isId(body[key])) errors[key] = "invalid";
  }
  if (Object.keys(errors).length > 0) {
    validationFailed(res, errors);
    return;
  }
  const professionalId = body.professionalId as number;
  const customerId = body.customerId as number;

  const users: { id: number; role: string }[] = await pool.query(
    "SELECT id, role FROM users WHERE id IN (?, ?)",
    [professionalId, customerId],
  );
  const roleOf = (id: number) => users.find((user) => user.id === id)?.role;
  const professionalRole = roleOf(professionalId);
  const customerRole = roleOf(customerId);
  if (!professionalRole) errors.professionalId = "not_found";
  else if (professionalRole !== "PROFESSIONAL") errors.professionalId = "invalid_role";
  if (!customerRole) errors.customerId = "not_found";
  else if (customerRole !== "USER") errors.customerId = "invalid_role";
  if (Object.keys(errors).length > 0) {
    validationFailed(res, errors);
    return;
  }

  let id: number;
  try {
    const result = await pool.query(
      "INSERT INTO professional_customer_access (professional_user_id, customer_user_id) VALUES (?, ?)",
      [professionalId, customerId],
    );
    id = Number(result.insertId);
  } catch (err) {
    // The unique key also catches two admins creating the same assignment at once.
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Assignment already exists" });
      return;
    }
    throw err;
  }
  res.status(201).json({ assignment: { id, professionalId, customerId } });
});

adminRouter.delete(`${ASSIGNMENTS}/:id`, async (req, res) => {
  if (rejectQuery(req, res)) return;
  const id = parseId(req.params.id);
  const result = id ? await pool.query("DELETE FROM professional_customer_access WHERE id = ?", [id]) : null;
  if (!result || result.affectedRows === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).end();
});
