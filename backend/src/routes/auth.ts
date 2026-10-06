import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { hashPassword, verifyDummyPassword, verifyPassword } from "../auth/password.js";
import { endSession, revokeSession, startSession, type AuthUser } from "../auth/sessions.js";
import { pool } from "../db.js";

export const authRouter = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 255;
const PASSWORD_MIN = 10;
// Caps hashing cost for absurdly long inputs.
const PASSWORD_MAX = 128;

type FieldErrors = Record<string, string>;

function readCredentials(body: unknown): { email: string; password: string } {
  const data = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return {
    email: typeof data.email === "string" ? data.email.trim().toLowerCase() : "",
    password: typeof data.password === "string" ? data.password : "",
  };
}

function validationError(fields: FieldErrors) {
  return { error: "Validation failed", fields };
}

authRouter.post("/register", async (req, res) => {
  // Only email and password are read; any submitted role is ignored.
  const { email, password } = readCredentials(req.body);

  const fields: FieldErrors = {};
  if (!email) fields.email = "required";
  else if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) fields.email = "invalid";
  if (!password) fields.password = "required";
  else if (password.length < PASSWORD_MIN) fields.password = "too_short";
  else if (password.length > PASSWORD_MAX) fields.password = "too_long";
  if (Object.keys(fields).length > 0) {
    res.status(400).json(validationError(fields));
    return;
  }

  const passwordHash = await hashPassword(password);
  let userId: number;
  try {
    const result = await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'USER')",
      [email, passwordHash],
    );
    userId = Number(result.insertId);
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      res.status(409).json(validationError({ email: "taken" }));
      return;
    }
    throw err;
  }

  await revokeSession(req);
  await startSession(res, userId);
  const user: AuthUser = { id: userId, email, role: "USER" };
  res.status(201).json({ user });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = readCredentials(req.body);

  const fields: FieldErrors = {};
  if (!email) fields.email = "required";
  if (!password) fields.password = "required";
  if (Object.keys(fields).length > 0) {
    res.status(400).json(validationError(fields));
    return;
  }

  const rows: (AuthUser & { password_hash: string })[] =
    password.length <= PASSWORD_MAX
      ? await pool.query("SELECT id, email, role, password_hash FROM users WHERE email = ?", [email])
      : [];
  const row = rows[0];

  // Same response and similar timing whether the email is unknown or the password is wrong.
  let valid = false;
  if (row) valid = await verifyPassword(row.password_hash, password);
  else await verifyDummyPassword(password);
  if (!row || !valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // New token on every login prevents session fixation.
  await revokeSession(req);
  await startSession(res, row.id);
  const user: AuthUser = { id: row.id, email: row.email, role: row.role };
  res.json({ user });
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
