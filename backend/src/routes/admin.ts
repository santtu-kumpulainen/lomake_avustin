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

// Same rule as the professional access check: expiry is compared with NOW() in the database, so
// there is only one clock and one time zone (the database's), as with sessions.
const EXPIRED = "(a.expires_at IS NOT NULL AND a.expires_at <= NOW())";

type AssignmentRow = {
  id: number;
  created_at: Date;
  purpose: string | null;
  expires_at: Date | null;
  expired: unknown;
  created_by_id: number | null;
  created_by_email: string | null;
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
    `SELECT a.id, a.created_at, a.purpose, a.expires_at, ${EXPIRED} AS expired,
            cb.id AS created_by_id, cb.email AS created_by_email,
            p.id AS professional_id, p.email AS professional_email,
            c.id AS customer_id, c.email AS customer_email, pr.first_name, pr.last_name
       FROM professional_customer_access a
       JOIN users p ON p.id = a.professional_user_id
       JOIN users c ON c.id = a.customer_user_id
       LEFT JOIN users cb ON cb.id = a.created_by_user_id
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
      purpose: row.purpose,
      expiresAt: row.expires_at,
      // NULL for assignments made before the creator was recorded, or whose admin was deleted.
      createdBy: row.created_by_id === null ? null : { id: row.created_by_id, email: row.created_by_email },
      status: Number(row.expired) ? "EXPIRED" : "ACTIVE",
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

const PURPOSE_MAX = 300;
// Single-line text: no control characters at all, including line breaks.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// ISO 8601 with an explicit offset, so the instant never depends on a server or browser time zone.
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function readPurpose(value: unknown, errors: FieldErrors): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors.purpose = "invalid";
    return null;
  }
  const purpose = value.trim();
  if (purpose.length > PURPOSE_MAX) errors.purpose = "too_long";
  else if (CONTROL_CHARS.test(purpose)) errors.purpose = "invalid";
  return purpose || null;
}

/** The expiry as a UTC 'YYYY-MM-DD HH:MM:SS' string, whole seconds (DATETIME precision). */
function readExpiry(value: unknown, errors: FieldErrors, now: Date): string | null {
  if (value === undefined || value === null) return null;
  const match = typeof value === "string" ? ISO_INSTANT.exec(value) : null;
  const time = match ? Date.parse(value as string) : NaN;
  // Date.parse rolls over impossible dates (2026-02-30), so the calendar parts are checked too.
  const [, year, month, day, hour, minute, second = "00"] = match ?? [];
  const parts = match && new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  const realDate =
    parts &&
    parts.getUTCFullYear() === +year &&
    parts.getUTCMonth() === +month - 1 &&
    parts.getUTCDate() === +day &&
    parts.getUTCHours() === +hour &&
    parts.getUTCMinutes() === +minute &&
    parts.getUTCSeconds() === +second;
  if (!realDate || Number.isNaN(time)) {
    errors.expiresAt = "invalid";
    return null;
  }
  const expires = new Date(Math.floor(time / 1000) * 1000);
  if (expires.getTime() <= now.getTime()) {
    errors.expiresAt = "in_past";
    return null;
  }
  if (expires.getUTCFullYear() > 9998) {
    errors.expiresAt = "invalid";
    return null;
  }
  return expires.toISOString().slice(0, 19).replace("T", " ");
}

const CREATE_KEYS = new Set(["professionalId", "customerId", "purpose", "expiresAt"]);

// Body `{ professionalId, customerId, purpose?, expiresAt? }`. Both accounts are looked up here and
// must have the right role in the database; nothing about roles is taken from the request. The
// creator is the admin of the session; a `createdBy` key is rejected like any other unknown key.
adminRouter.post(ASSIGNMENTS, async (req, res) => {
  if (rejectQuery(req, res)) return;
  const body: Record<string, unknown> =
    typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? req.body : {};

  const errors: FieldErrors = {};
  for (const key of Object.keys(body)) {
    if (!CREATE_KEYS.has(key)) errors[key] = "not_allowed";
  }
  for (const key of ["professionalId", "customerId"] as const) {
    if (body[key] === undefined || body[key] === null) errors[key] = "required";
    else if (!isId(body[key])) errors[key] = "invalid";
  }
  const purpose = readPurpose(body.purpose, errors);
  const expiresAt = readExpiry(body.expiresAt, errors, new Date());
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

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // The expiry is given in UTC and converted to the database time zone, which NOW() uses.
    const result = await conn.query(
      `INSERT INTO professional_customer_access
         (professional_user_id, customer_user_id, created_by_user_id, purpose, expires_at)
       VALUES (?, ?, ?, ?, CONVERT_TZ(?, '+00:00', @@session.time_zone))`,
      [professionalId, customerId, req.user!.id, purpose, expiresAt],
    );
    const id = Number(result.insertId);
    const [created]: { expires_at: Date | null }[] = await conn.query(
      "SELECT expires_at FROM professional_customer_access WHERE id = ?",
      [id],
    );
    // CONVERT_TZ gives NULL for a time zone it cannot resolve. That would silently create an
    // assignment that never expires, so fail closed instead.
    if (expiresAt !== null && !created.expires_at) throw new Error("Assignment expiry could not be stored");
    await conn.commit();
    res.status(201).json({
      assignment: { id, professionalId, customerId, purpose, expiresAt: created.expires_at },
    });
  } catch (err) {
    await conn.rollback();
    // The unique key also catches two admins creating the same assignment at once.
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Assignment already exists" });
      return;
    }
    throw err;
  } finally {
    conn.release();
  }
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
