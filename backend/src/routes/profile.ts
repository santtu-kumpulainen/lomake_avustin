import { Router } from "express";
import { requireRole } from "../auth/middleware.js";
import { pool } from "../db.js";
import { validateProfile } from "../profile/validation.js";

export const profileRouter = Router();

// Customers only. The routes never take a user id: the owner is always the session user,
// so no role can read or change another user's profile through them.
profileRouter.use(requireRole("USER"));

type ProfileRow = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  phone: string | null;
  updated_at: Date | null;
};

async function loadProfile(userId: number) {
  // DATE_FORMAT returns the stored day as text, so no time zone conversion can shift it.
  const [row]: ProfileRow[] = await pool.query(
    `SELECT u.email, p.first_name, p.last_name,
            DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth, p.phone, p.updated_at
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ?`,
    [userId],
  );
  // Explicit allowlist: only these fields ever leave the server.
  return {
    email: row.email,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    updatedAt: row.updated_at,
  };
}

profileRouter.get("/", async (req, res) => {
  res.json({ profile: await loadProfile(req.user!.id) });
});

profileRouter.put("/", async (req, res) => {
  const result = validateProfile(req.body);
  if (!result.ok) {
    res.status(400).json({ error: "Validation failed", fields: result.errors });
    return;
  }
  const { firstName, lastName, dateOfBirth, phone } = result.input;
  // One row per user (PK user_id): the first save creates it, later saves replace it.
  await pool.query(
    `INSERT INTO user_profiles (user_id, first_name, last_name, date_of_birth, phone)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE first_name = VALUES(first_name), last_name = VALUES(last_name),
       date_of_birth = VALUES(date_of_birth), phone = VALUES(phone)`,
    [req.user!.id, firstName, lastName, dateOfBirth, phone],
  );
  res.json({ profile: await loadProfile(req.user!.id) });
});
