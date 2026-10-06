// Dev helper for ADMIN / PROFESSIONAL test accounts. Public registration always creates USER;
// changing a role requires shell access to the backend, which keeps role escalation off the API.
// Usage: npm run set-role -- <email> <USER|ADMIN|PROFESSIONAL>
import { ROLES, type Role } from "../auth/sessions.js";
import { pool } from "../db.js";

const [email, role] = process.argv.slice(2);

if (!email || !ROLES.includes(role as Role)) {
  console.error(`Usage: npm run set-role -- <email> <${ROLES.join("|")}>`);
  process.exit(1);
}

try {
  const result = await pool.query("UPDATE users SET role = ? WHERE email = ?", [
    role,
    email.trim().toLowerCase(),
  ]);
  if (result.affectedRows === 0) {
    console.error(`No user found with email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`Role of ${email} set to ${role}`);
  }
} finally {
  await pool.end();
}
