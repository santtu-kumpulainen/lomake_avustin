import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { config } from "../config.js";
import { pool } from "../db.js";

export const ROLES = ["USER", "ADMIN", "PROFESSIONAL"] as const;
export type Role = (typeof ROLES)[number];

export type AuthUser = {
  id: number;
  email: string;
  role: Role;
};

export const SESSION_COOKIE = "la_session";

const cookieOptions: CookieOptions = {
  httpOnly: true,
  // Lax keeps the cookie off cross-site POSTs, which covers CSRF for this JSON API.
  sameSite: "lax",
  secure: config.session.cookieSecure,
  path: "/",
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=");
      return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}

export async function startSession(res: Response, userId: number): Promise<void> {
  const token = randomBytes(32).toString("hex");
  // Opportunistic cleanup keeps the table small without a scheduled job.
  await pool.query("DELETE FROM sessions WHERE expires_at < NOW()");
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))",
    [hashToken(token), userId, config.session.ttlHours],
  );
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions,
    maxAge: config.session.ttlHours * 60 * 60 * 1000,
  });
}

// Deletes the session row, so the token is invalid even if a copy of the cookie exists.
export async function revokeSession(req: Request): Promise<void> {
  const token = readSessionToken(req);
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
  }
}

export async function endSession(req: Request, res: Response): Promise<void> {
  await revokeSession(req);
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

// Role is read from users on every request, so a role change takes effect immediately.
export async function getSessionUser(req: Request): Promise<AuthUser | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  const rows: AuthUser[] = await pool.query(
    `SELECT u.id, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > NOW()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}
