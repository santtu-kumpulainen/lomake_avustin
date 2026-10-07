// Integration tests for the submitted forms view (Issue #22) against the configured MariaDB.
// Users, templates and submissions created here are deleted afterwards. Synthetic data only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

const PASSWORD = "testisalasana-123";
const createdEmails: string[] = [];
const createdTemplateIds: number[] = [];

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
let adminCookie: string;

type TestUser = { cookie: string; id: number };
let user: TestUser;
let otherUser: TestUser;

// Required TEXT, optional NUMBER, optional DATE, required SELECT.
let form: { id: number; name: string; fields: Record<"name" | "height" | "visitDate" | "reason", number> };

async function request(method: string, path: string, body?: unknown, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createUser(role: "USER" | "ADMIN" | "PROFESSIONAL" = "USER"): Promise<TestUser> {
  const email = `submitted-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  const { user: created } = await res.json();
  if (role !== "USER") await pool.query("UPDATE users SET role = ? WHERE email = ?", [role, email]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: created.id };
}

function answers(overrides: Record<string, string> = {}) {
  return { [form.fields.name]: "Testi Henkilö", [form.fields.reason]: "Lääkityksen läpikäynti", ...overrides };
}

async function submit(cookie: string, values = answers()) {
  const res = await request("POST", "/api/submissions", { formTemplateId: form.id, answers: values }, cookie);
  assert.equal(res.status, 201);
  return (await res.json()).submission;
}

async function list(cookie: string, query = "") {
  return request("GET", `/api/submissions${query}`, undefined, cookie);
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminCookie = (await createUser("ADMIN")).cookie;
  user = await createUser();
  otherUser = await createUser();

  const name = `Testilomake ${randomUUID()}`;
  let res = await request("POST", "/api/forms", { name }, adminCookie);
  const { template } = await res.json();
  createdTemplateIds.push(template.id);
  let fields: { id: number }[] = [];
  for (const field of [
    { label: "Nimi", fieldType: "TEXT", required: true },
    { label: "Pituus (cm)", fieldType: "NUMBER" },
    { label: "Toivottu käyntipäivä", fieldType: "DATE" },
    { label: "Asioinnin syy", fieldType: "SELECT", required: true, options: ["Vastaanotolle", "Lääkityksen läpikäynti"] },
  ]) {
    res = await request("POST", `/api/forms/${template.id}/fields`, field, adminCookie);
    fields = (await res.json()).template.fields;
  }
  res = await request("POST", `/api/forms/${template.id}/publish`, undefined, adminCookie);
  assert.equal(res.status, 200);
  const [nameId, height, visitDate, reason] = fields.map((f) => f.id);
  form = { id: template.id, name, fields: { name: nameId, height, visitDate, reason } };
});

after(async () => {
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  if (createdTemplateIds.length > 0) {
    await pool.query("DELETE FROM form_templates WHERE id IN (?)", [createdTemplateIds]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("listing submitted forms", () => {
  test("unauthenticated requests get 401", async () => {
    assert.equal((await request("GET", "/api/submissions")).status, 401);
    assert.equal((await request("GET", "/api/submissions/1")).status, 401);
  });

  test("a user lists only their own SUBMITTED forms, newest first", async () => {
    const fresh = await createUser();
    const first = await submit(fresh.cookie);
    // Second one goes through a draft, which must leave the draft list and appear here.
    const draftRes = await request("POST", "/api/submissions/draft", { formTemplateId: form.id, answers: answers() }, fresh.cookie);
    const draft = (await draftRes.json()).submission;
    assert.equal((await request("POST", `/api/submissions/${draft.id}/submit`, {}, fresh.cookie)).status, 200);
    // An unfinished draft stays out of the list.
    await request("POST", "/api/submissions/draft", { formTemplateId: form.id, answers: {} }, fresh.cookie);
    await submit(otherUser.cookie);

    const res = await list(fresh.cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ["submissions"]);
    assert.deepEqual(
      body.submissions.map((s: { id: number }) => s.id).sort(),
      [first.id, draft.id].sort(),
      "own submitted forms only: no drafts, no other users",
    );
    const [newest] = body.submissions;
    assert.deepEqual(Object.keys(newest).sort(), ["formName", "formTemplateId", "id", "referenceCode", "status", "submittedAt"]);
    for (const item of body.submissions) {
      assert.equal(item.status, "SUBMITTED");
      assert.equal(item.formName, form.name);
      assert.match(item.referenceCode, /^LA-[2-9A-HJ-NP-Z]{6}$/);
      assert.ok(item.submittedAt);
    }
    const times = body.submissions.map((s: { submittedAt: string; id: number }) => [Date.parse(s.submittedAt), s.id]);
    assert.ok(times[0][0] > times[1][0] || (times[0][0] === times[1][0] && times[0][1] > times[1][1]), "newest first");
  });

  test("a user without submissions gets an empty list", async () => {
    const fresh = await createUser();
    await request("POST", "/api/submissions/draft", { formTemplateId: form.id, answers: {} }, fresh.cookie);
    assert.deepEqual(await (await list(fresh.cookie)).json(), { submissions: [] });
  });

  test("ownership cannot be overridden with query parameters", async () => {
    await submit(otherUser.cookie);
    for (const key of ["userId", "user_id", "email", "role"]) {
      const res = await list(user.cookie, `?${key}=${otherUser.id}`);
      assert.equal(res.status, 400);
      assert.deepEqual((await res.json()).fields, { [key]: "not_allowed" });
    }
  });

  test("ADMIN and PROFESSIONAL only ever see their own submissions", async () => {
    const own = await submit(user.cookie);
    for (const role of ["ADMIN", "PROFESSIONAL"] as const) {
      const staff = await createUser(role);
      const body = await (await list(staff.cookie)).json();
      assert.deepEqual(body.submissions, []);
      assert.equal((await request("GET", `/api/submissions/${own.id}`, undefined, staff.cookie)).status, 404);
    }
  });
});

describe("submission detail", () => {
  test("shows every question of the form in order with the submitted answers", async () => {
    const submitted = await submit(
      user.cookie,
      answers({ [form.fields.visitDate]: "2026-10-20", [form.fields.reason]: "Vastaanotolle" }),
    );
    const res = await request("GET", `/api/submissions/${submitted.id}`, undefined, user.cookie);
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.status, "SUBMITTED");
    assert.equal(submission.referenceCode, submitted.referenceCode);
    assert.equal(submission.formName, form.name);
    assert.ok(submission.submittedAt);
    // The empty optional NUMBER is listed with null; SELECT is the option text; DATE stays ISO.
    assert.deepEqual(submission.answers, [
      { fieldId: form.fields.name, label: "Nimi", fieldType: "TEXT", value: "Testi Henkilö" },
      { fieldId: form.fields.height, label: "Pituus (cm)", fieldType: "NUMBER", value: null },
      { fieldId: form.fields.visitDate, label: "Toivottu käyntipäivä", fieldType: "DATE", value: "2026-10-20" },
      { fieldId: form.fields.reason, label: "Asioinnin syy", fieldType: "SELECT", value: "Vastaanotolle" },
    ]);
    const text = JSON.stringify(submission).toLowerCase();
    for (const internal of ["password", "hash", "token", "session", "email", "userid", "user_id"]) {
      assert.ok(!text.includes(internal), `detail contains ${internal}`);
    }
  });

  test("another user's submission is 404, also with userId in the query", async () => {
    const theirs = await submit(otherUser.cookie);
    for (const path of [
      `/api/submissions/${theirs.id}`,
      `/api/submissions/${theirs.id}?userId=${otherUser.id}`,
      `/api/submissions/${theirs.id}?user_id=${otherUser.id}`,
    ]) {
      const res = await request("GET", path, undefined, user.cookie);
      assert.equal(res.status, 404);
      assert.ok(!(await res.text()).includes(theirs.referenceCode));
    }
  });

  test("a question added to the form after submitting is not shown as part of it", async () => {
    const submitted = await submit(user.cookie);
    await request("POST", `/api/forms/${form.id}/unpublish`, undefined, adminCookie);
    const res = await request("POST", `/api/forms/${form.id}/fields`, { label: "Myöhemmin lisätty", fieldType: "TEXT" }, adminCookie);
    const added = (await res.json()).template.fields.at(-1);
    // Same-second timestamps would count as "existed"; move the new field clearly after the submission.
    await pool.query(
      "UPDATE form_fields SET created_at = (SELECT submitted_at FROM form_submissions WHERE id = ?) + INTERVAL 1 MINUTE WHERE id = ?",
      [submitted.id, added.id],
    );
    await request("POST", `/api/forms/${form.id}/publish`, undefined, adminCookie);

    const { submission } = await (await request("GET", `/api/submissions/${submitted.id}`, undefined, user.cookie)).json();
    assert.ok(!submission.answers.some((a: { fieldId: number }) => a.fieldId === added.id));
    assert.equal(submission.answers.length, 4);
  });

  test("viewing never changes a submitted form or turns it into a draft", async () => {
    const submitted = await submit(user.cookie);
    const [before] = await pool.query("SELECT status, updated_at, submitted_at FROM form_submissions WHERE id = ?", [submitted.id]);
    await request("GET", `/api/submissions/${submitted.id}`, undefined, user.cookie);
    await list(user.cookie);
    const [afterRow] = await pool.query("SELECT status, updated_at, submitted_at FROM form_submissions WHERE id = ?", [submitted.id]);
    assert.deepEqual({ ...afterRow }, { ...before });
    // Existing rules still refuse to edit it.
    const edit = await request("POST", "/api/submissions/draft", { id: submitted.id, answers: { [form.fields.name]: "Muutettu" } }, user.cookie);
    assert.equal(edit.status, 409);
  });

  test("an own draft is still returned as DRAFT without a reference code", async () => {
    const res = await request("POST", "/api/submissions/draft", { formTemplateId: form.id, answers: { [form.fields.name]: "Kesken" } }, user.cookie);
    const draft = (await res.json()).submission;
    const { submission } = await (await request("GET", `/api/submissions/${draft.id}`, undefined, user.cookie)).json();
    assert.equal(submission.status, "DRAFT");
    assert.equal(submission.referenceCode, null);
    assert.equal(submission.submittedAt, null);
    assert.deepEqual(
      submission.answers.map((a: { fieldId: number; value: string }) => [a.fieldId, a.value]),
      [[form.fields.name, "Kesken"]],
    );
  });
});
