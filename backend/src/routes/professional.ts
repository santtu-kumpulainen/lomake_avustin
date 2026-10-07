import { Router } from "express";
import { requireRole } from "../auth/middleware.js";
import { pool } from "../db.js";

export const professionalRouter = Router();

// Professionals only; ADMIN has its own routes. A role alone does not grant access to any
// customer's data, so these routes return aggregate counts only and never take a user id.
// Access to individual customers needs the controlled relationship model (a later issue).
professionalRouter.use(requireRole("PROFESSIONAL"));

// Days are Finnish calendar days. Timestamps are stored in the database time zone, so the
// boundaries are converted back to it. COALESCE keeps counts correct (UTC days) if the
// time zone tables are ever missing, instead of silently comparing against NULL.
const TIME_ZONE = "Europe/Helsinki";
const BOUNDARIES = `
  SELECT
    COALESCE(CONVERT_TZ(DATE(CONVERT_TZ(NOW(), @@session.time_zone, ?)), ?, @@session.time_zone), CURDATE()) AS today_start,
    COALESCE(CONVERT_TZ(DATE(CONVERT_TZ(NOW(), @@session.time_zone, ?)) - INTERVAL 6 DAY, ?, @@session.time_zone), CURDATE() - INTERVAL 6 DAY) AS week_start`;
const BOUNDARY_PARAMS = [TIME_ZONE, TIME_ZONE, TIME_ZONE, TIME_ZONE];

// Only submitted forms of customer (USER) accounts count; staff test submissions and drafts do not.
const CUSTOMER_SUBMISSIONS = `
  form_submissions s
  JOIN users u ON u.id = s.user_id AND u.role = 'USER'`;

const RECENT_FORMS_LIMIT = 10;

type TotalsRow = { today: unknown; last_7_days: unknown; total: unknown };
type FormRow = { id: number; name: string; category: string | null; n: unknown };

professionalRouter.get("/dashboard", async (req, res) => {
  // No query parameters, so nothing like `userId` or `customerId` can narrow or widen the data.
  const unexpected = Object.keys(req.query);
  if (unexpected.length > 0) {
    res.status(400).json({
      error: "Validation failed",
      fields: Object.fromEntries(unexpected.map((key) => [key, "not_allowed"])),
    });
    return;
  }

  const [totals]: TotalsRow[] = await pool.query(
    `SELECT COALESCE(SUM(s.submitted_at >= b.today_start), 0) AS today,
            COALESCE(SUM(s.submitted_at >= b.week_start), 0) AS last_7_days,
            COUNT(*) AS total
       FROM ${CUSTOMER_SUBMISSIONS}
       CROSS JOIN (${BOUNDARIES}) b
      WHERE s.status = 'SUBMITTED'`,
    BOUNDARY_PARAMS,
  );

  const forms: FormRow[] = await pool.query(
    `SELECT t.id, t.name, t.category, COUNT(*) AS n
       FROM ${CUSTOMER_SUBMISSIONS}
       JOIN form_templates t ON t.id = s.form_template_id
       CROSS JOIN (${BOUNDARIES}) b
      WHERE s.status = 'SUBMITTED' AND s.submitted_at >= b.week_start
      GROUP BY t.id, t.name, t.category
      ORDER BY n DESC, t.name, t.id
      LIMIT ?`,
    [...BOUNDARY_PARAMS, RECENT_FORMS_LIMIT],
  );

  // Explicit allowlist: counts and form template details only, no customer data.
  res.json({
    dashboard: {
      submittedForms: {
        today: Number(totals.today),
        last7Days: Number(totals.last_7_days),
        total: Number(totals.total),
      },
      formsLast7Days: forms.map((row) => ({
        formTemplateId: row.id,
        name: row.name,
        category: row.category,
        submittedForms: Number(row.n),
      })),
    },
  });
});
