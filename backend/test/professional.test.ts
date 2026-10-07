// Professional dashboard (Issue #30). Integration tests against the configured MariaDB
// (synthetic data only). Metrics are checked as differences before and after inserting this
// file's own rows, so other data in the database does not affect the result. Everything
// created here is deleted afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

const PASSWORD = "testisalasana-123";
const PATH = "/api/professional/dashboard";
const createdEmails: string[] = [];
const createdTemplateIds: number[] = [];

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

type Role = "USER" | "ADMIN" | "PROFESSIONAL";
type Account = { cookie: string; id: number; email: string };
const accounts = {} as Record<"USER" | "OTHER" | "ADMIN" | "PROFESSIONAL", Account>;

type Dashboard = {
  submittedForms: { today: number; last7Days: number; total: number };
  formsLast7Days: { formTemplateId: number; name: string; category: string | null; submittedForms: number }[];
};

async function request(method: string, path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, { method, headers: cookie ? { Cookie: cookie } : {} });
}

async function createUser(role: Role): Promise<Account> {
  const email = `professional-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.equal(res.status, 201);
  const { user } = await res.json();
  await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, user.id]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: user.id, email };
}

async function createTemplate(name: string): Promise<number> {
  const result = await pool.query(
    "INSERT INTO form_templates (name, description, status, category) VALUES (?, ?, 'PUBLISHED', ?)",
    [name, "Testilomake ammattilaisen työpöydälle.", "Testiaihe"],
  );
  const id = Number(result.insertId);
  createdTemplateIds.push(id);
  return id;
}

// Local Finnish times are converted to the database time zone the same way the route does.
const HELSINKI_DAY = "DATE(CONVERT_TZ(NOW(), @@session.time_zone, 'Europe/Helsinki'))";
const toDb = (localExpr: string) => `CONVERT_TZ(${localExpr}, 'Europe/Helsinki', @@session.time_zone)`;
const WHEN = {
  now: "NOW()",
  yesterdayNoon: toDb(`${HELSINKI_DAY} - INTERVAL 1 DAY + INTERVAL 12 HOUR`),
  sixDaysAgo: toDb(`${HELSINKI_DAY} - INTERVAL 6 DAY + INTERVAL 1 MINUTE`),
  sevenDaysAgo: toDb(`${HELSINKI_DAY} - INTERVAL 7 DAY + INTERVAL 12 HOUR`),
};

async function insertSubmission(userId: number, templateId: number, when: keyof typeof WHEN | null) {
  const code = `LA-T${randomUUID().slice(0, 8).toUpperCase()}`;
  if (when === null) {
    await pool.query(
      "INSERT INTO form_submissions (user_id, form_template_id, status, reference_code) VALUES (?, ?, 'DRAFT', ?)",
      [userId, templateId, code],
    );
    return;
  }
  await pool.query(
    `INSERT INTO form_submissions (user_id, form_template_id, status, reference_code, submitted_at)
     VALUES (?, ?, 'SUBMITTED', ?, ${WHEN[when]})`,
    [userId, templateId, code],
  );
}

async function dashboard(account = accounts.PROFESSIONAL): Promise<Dashboard> {
  const res = await request("GET", PATH, account.cookie);
  assert.equal(res.status, 200);
  return (await res.json()).dashboard;
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  accounts.USER = await createUser("USER");
  accounts.OTHER = await createUser("USER");
  accounts.ADMIN = await createUser("ADMIN");
  accounts.PROFESSIONAL = await createUser("PROFESSIONAL");
});

after(async () => {
  // Submissions cascade with their users; templates can only go once their submissions are gone.
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  if (createdTemplateIds.length > 0) {
    await pool.query("DELETE FROM form_templates WHERE id IN (?)", [createdTemplateIds]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("authorization", () => {
  test("requires a session", async () => {
    assert.equal((await request("GET", PATH)).status, 401);
  });

  test("USER and ADMIN get 403", async () => {
    for (const role of ["USER", "ADMIN"] as const) {
      const res = await request("GET", PATH, accounts[role].cookie);
      assert.equal(res.status, 403, role);
      assert.deepEqual(await res.json(), { error: "Forbidden" }, role);
    }
  });

  test("PROFESSIONAL is allowed", async () => {
    const res = await request("GET", PATH, accounts.PROFESSIONAL.cookie);
    assert.equal(res.status, 200);
  });

  test("an expired or unknown session gets 401", async () => {
    assert.equal((await request("GET", PATH, "la_session=not-a-real-token")).status, 401);
  });

  test("the professional role does not open customer-only routes", async () => {
    for (const path of ["/api/profile", "/api/symptom-descriptions"]) {
      assert.equal((await request("GET", path, accounts.PROFESSIONAL.cookie)).status, 403, path);
    }
  });

  test("no route returns a single customer under /api/professional", async () => {
    for (const path of [
      `/api/professional/customers`,
      `/api/professional/customers/${accounts.USER.id}`,
      `/api/professional/users/${accounts.USER.id}`,
      `/api/professional/submissions`,
    ]) {
      assert.equal((await request("GET", path, accounts.PROFESSIONAL.cookie)).status, 404, path);
    }
  });
});

describe("query safety", () => {
  test("userId, customerId and any other query parameter are rejected", async () => {
    for (const query of [
      `userId=${accounts.USER.id}`,
      `customerId=${accounts.USER.id}`,
      `user_id=${accounts.USER.id}`,
      "email=x@example.test",
    ]) {
      const res = await request("GET", `${PATH}?${query}`, accounts.PROFESSIONAL.cookie);
      assert.equal(res.status, 400, query);
      const body = await res.json();
      assert.equal(body.error, "Validation failed");
      assert.equal(body.fields[query.split("=")[0]], "not_allowed");
      assert.equal(body.dashboard, undefined);
    }
  });

  test("query parameters do not get past the role check", async () => {
    const res = await request("GET", `${PATH}?userId=${accounts.USER.id}`, accounts.USER.cookie);
    assert.equal(res.status, 403);
  });
});

describe("metrics", () => {
  test("counts customer submissions today, in the last 7 days and in total", async () => {
    const templateA = await createTemplate(`Työpöytätesti A ${randomUUID()}`);
    const templateB = await createTemplate(`Työpöytätesti B ${randomUUID()}`);
    const before = await dashboard();

    await insertSubmission(accounts.USER.id, templateA, "now");
    await insertSubmission(accounts.OTHER.id, templateA, "now");
    await insertSubmission(accounts.USER.id, templateA, "yesterdayNoon");
    await insertSubmission(accounts.OTHER.id, templateB, "sixDaysAgo");
    await insertSubmission(accounts.USER.id, templateB, "sevenDaysAgo");
    // Not counted: drafts and staff accounts' own submissions.
    await insertSubmission(accounts.USER.id, templateA, null);
    await insertSubmission(accounts.PROFESSIONAL.id, templateA, "now");
    await insertSubmission(accounts.ADMIN.id, templateB, "now");

    const after = await dashboard();
    assert.equal(after.submittedForms.today - before.submittedForms.today, 2);
    assert.equal(after.submittedForms.last7Days - before.submittedForms.last7Days, 4);
    assert.equal(after.submittedForms.total - before.submittedForms.total, 5);

    const a = after.formsLast7Days.find((form) => form.formTemplateId === templateA);
    const b = after.formsLast7Days.find((form) => form.formTemplateId === templateB);
    assert.ok(a && b, "both test forms are listed");
    assert.equal(a.submittedForms, 3);
    assert.equal(b.submittedForms, 1, "the 7-days-ago submission is outside the window");
    assert.equal(a.category, "Testiaihe");
  });

  test("forms are ordered by count and limited to 10", async () => {
    const { formsLast7Days } = await dashboard();
    assert.ok(formsLast7Days.length <= 10);
    for (let i = 1; i < formsLast7Days.length; i++) {
      assert.ok(formsLast7Days[i - 1].submittedForms >= formsLast7Days[i].submittedForms);
    }
  });

  test("a form with only older submissions is not listed", async () => {
    const template = await createTemplate(`Työpöytätesti vanha ${randomUUID()}`);
    await insertSubmission(accounts.USER.id, template, "sevenDaysAgo");
    const { formsLast7Days } = await dashboard();
    assert.equal(
      formsLast7Days.some((form) => form.formTemplateId === template),
      false,
    );
  });

  test("reading the dashboard changes nothing", async () => {
    const [before] = await pool.query("SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM form_submissions");
    await dashboard();
    const [after] = await pool.query("SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM form_submissions");
    assert.deepEqual(after, before);
  });
});

describe("data exposure", () => {
  test("the response holds only aggregate fields and no customer data", async () => {
    const template = await createTemplate(`Työpöytätesti tietosuoja ${randomUUID()}`);
    const customer = await createUser("USER");
    const marker = `Salainen-${randomUUID()}`;
    await pool.query(
      "INSERT INTO user_profiles (user_id, first_name, last_name, date_of_birth, phone) VALUES (?, ?, ?, ?, ?)",
      [customer.id, `Etu${marker}`, `Suku${marker}`, "1980-04-12", "+358401234567"],
    );
    await pool.query("INSERT INTO symptom_descriptions (user_id, description) VALUES (?, ?)", [
      customer.id,
      `Oirekuvaus ${marker}`,
    ]);
    const field = await pool.query(
      "INSERT INTO form_fields (form_template_id, label, field_type, is_required, position) VALUES (?, ?, 'TEXT', 0, 1)",
      [template, "Kysymys"],
    );
    await insertSubmission(customer.id, template, "now");
    const [submission] = await pool.query(
      "SELECT id, reference_code FROM form_submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      [customer.id],
    );
    await pool.query("INSERT INTO form_answers (submission_id, field_id, answer_value) VALUES (?, ?, ?)", [
      submission.id,
      Number(field.insertId),
      `Vastaus ${marker}`,
    ]);

    const res = await request("GET", PATH, accounts.PROFESSIONAL.cookie);
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);

    assert.deepEqual(Object.keys(body), ["dashboard"]);
    assert.deepEqual(Object.keys(body.dashboard).sort(), ["formsLast7Days", "submittedForms"]);
    assert.deepEqual(Object.keys(body.dashboard.submittedForms).sort(), ["last7Days", "today", "total"]);
    for (const form of body.dashboard.formsLast7Days) {
      assert.deepEqual(Object.keys(form).sort(), ["category", "formTemplateId", "name", "submittedForms"]);
    }

    for (const secret of [
      marker,
      customer.email,
      "+358401234567",
      "1980-04-12",
      submission.reference_code,
      "Oirekuvaus",
      "Vastaus ",
    ]) {
      assert.equal(text.includes(secret), false, `response must not contain ${secret}`);
    }
    for (const key of ["userId", "user_id", "customerId", "email", "phone", "dateOfBirth", "referenceCode", "answers", "description"]) {
      assert.equal(text.includes(`"${key}"`), false, `response must not contain key ${key}`);
    }
  });
});
