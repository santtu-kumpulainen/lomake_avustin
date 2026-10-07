import { Router } from "express";
import { requireRole } from "../auth/middleware.js";
import { pool } from "../db.js";
import { parseId } from "../forms/validation.js";
import { listSubmitted, loadSubmission } from "./submissions.js";

export const professionalRouter = Router();

// Professionals only; ADMIN has its own routes. A role alone does not grant access to any
// customer's data: the dashboard is aggregate only, and customer routes require an explicit
// assignment in professional_customer_access (Issue #32). The professional is always the
// session user; no route takes a professional or user id.
professionalRouter.use(requireRole("PROFESSIONAL"));

// No query parameters anywhere, so nothing like `userId`, `professionalId` or `customerId`
// can narrow or widen the data.
professionalRouter.use((req, res, next) => {
  const unexpected = Object.keys(req.query);
  if (unexpected.length > 0) {
    res.status(400).json({
      error: "Validation failed",
      fields: Object.fromEntries(unexpected.map((key) => [key, "not_allowed"])),
    });
    return;
  }
  next();
});

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

professionalRouter.get("/dashboard", async (_req, res) => {
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

// Assigned customers that are still customers. Roles are re-checked on every read, so an
// assignment stops granting access if either account's role changes later.
const ASSIGNED_CUSTOMERS = `
  professional_customer_access a
  JOIN users p ON p.id = a.professional_user_id AND p.role = 'PROFESSIONAL'
  JOIN users c ON c.id = a.customer_user_id AND c.role = 'USER'`;

type CustomerRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
};

// Minimal identification only; no email, descriptions, submissions or answers.
professionalRouter.get("/customers", async (req, res) => {
  const rows: CustomerRow[] = await pool.query(
    `SELECT c.id, pr.first_name, pr.last_name, DATE_FORMAT(pr.date_of_birth, '%Y-%m-%d') AS date_of_birth
       FROM ${ASSIGNED_CUSTOMERS}
       LEFT JOIN user_profiles pr ON pr.user_id = c.id
      WHERE a.professional_user_id = ?
      ORDER BY pr.last_name IS NULL, pr.last_name, pr.first_name, c.id`,
    [req.user!.id],
  );
  res.json({
    customers: rows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      dateOfBirth: row.date_of_birth,
    })),
  });
});

// The gate for every route with :customerId. Unassigned, unknown and malformed ids all get the
// same 404, so a professional cannot probe which customers exist.
professionalRouter.param("customerId", async (req, res, next, value) => {
  try {
    const customerId = parseId(value);
    const rows: { id: number }[] = customerId
      ? await pool.query(
          `SELECT c.id FROM ${ASSIGNED_CUSTOMERS}
            WHERE a.professional_user_id = ? AND a.customer_user_id = ?`,
          [req.user!.id, customerId],
        )
      : [];
    if (!rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.locals.customerId = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
});

// Read-only basic profile. Email is the customer's login and is not needed here, so it is left out.
professionalRouter.get("/customers/:customerId", async (_req, res) => {
  const customerId: number = res.locals.customerId;
  const [row]: (CustomerRow & { phone: string | null })[] = await pool.query(
    `SELECT u.id, p.first_name, p.last_name, DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth, p.phone
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ?`,
    [customerId],
  );
  res.json({
    customer: {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      dateOfBirth: row.date_of_birth,
      phone: row.phone,
    },
  });
});

professionalRouter.get("/customers/:customerId/symptom-descriptions", async (_req, res) => {
  const rows: { description: string; created_at: Date }[] = await pool.query(
    `SELECT description, created_at FROM symptom_descriptions
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC`,
    [res.locals.customerId],
  );
  res.json({
    symptomDescriptions: rows.map((row) => ({ description: row.description, createdAt: row.created_at })),
  });
});

professionalRouter.get("/customers/:customerId/submissions", async (_req, res) => {
  res.json({ submissions: await listSubmitted(res.locals.customerId) });
});

// The submission must belong to this customer and be submitted; drafts are a 404 like any
// other id the professional may not see.
professionalRouter.get("/customers/:customerId/submissions/:submissionId", async (req, res) => {
  const submissionId = parseId(req.params.submissionId);
  const submission = submissionId
    ? await loadSubmission(pool, submissionId, res.locals.customerId, { withUnanswered: true })
    : undefined;
  if (!submission || submission.status !== "SUBMITTED") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    submission: {
      id: submission.id,
      formTemplateId: submission.formTemplateId,
      formName: submission.formName,
      status: submission.status,
      referenceCode: submission.referenceCode,
      submittedAt: submission.submittedAt,
      answers: submission.answers,
    },
  });
});
