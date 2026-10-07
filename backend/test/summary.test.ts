// Integration tests for the summary flow (Issue #16) against the configured MariaDB.
// The summary and its confirmation are UI steps; these tests check that the final submit
// the summary uses stays authoritative. Synthetic data only, deleted afterwards.
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
let userCookie: string;
let userId: number;
let otherUserCookie: string;

// Required TEXT, optional NUMBER, required SELECT.
let form: { id: number; fields: Record<"name" | "height" | "smokes", number> };

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

async function createUser(role: "ADMIN" | "USER"): Promise<{ cookie: string; id: number }> {
  const email = `summary-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  const { user } = await res.json();
  await pool.query("UPDATE users SET role = ? WHERE email = ?", [role, email]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: user.id };
}

async function newDraft(answers: Record<string, string>, cookie = userCookie) {
  const res = await request("POST", "/api/submissions/draft", { formTemplateId: form.id, answers }, cookie);
  assert.equal(res.status, 201);
  return (await res.json()).submission;
}

function submitDraft(id: number, body: unknown, cookie = userCookie) {
  return request("POST", `/api/submissions/${id}/submit`, body, cookie);
}

async function submissionCount() {
  const [row] = await pool.query(
    "SELECT COUNT(*) AS n FROM form_submissions WHERE user_id = ? AND form_template_id = ? AND status = 'SUBMITTED'",
    [userId, form.id],
  );
  return Number(row.n);
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminCookie = (await createUser("ADMIN")).cookie;
  const user = await createUser("USER");
  userCookie = user.cookie;
  userId = user.id;
  otherUserCookie = (await createUser("USER")).cookie;

  let res = await request("POST", "/api/forms", { name: `Testilomake ${randomUUID()}` }, adminCookie);
  const { template } = await res.json();
  createdTemplateIds.push(template.id);
  let fields: { id: number }[] = [];
  for (const field of [
    { label: "Nimi", fieldType: "TEXT", required: true },
    { label: "Pituus (cm)", fieldType: "NUMBER" },
    { label: "Tupakoitko?", fieldType: "SELECT", required: true, options: ["Kyllä", "Ei"] },
  ]) {
    res = await request("POST", `/api/forms/${template.id}/fields`, field, adminCookie);
    fields = (await res.json()).template.fields;
  }
  res = await request("POST", `/api/forms/${template.id}/publish`, undefined, adminCookie);
  assert.equal(res.status, 200);
  const [name, height, smokes] = fields.map((f) => f.id);
  form = { id: template.id, fields: { name, height, smokes } };
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

describe("final submission after the summary", () => {
  test("a client-side confirmation flag does not bypass validation", async () => {
    const draft = await newDraft({ [form.fields.name]: "Testi Henkilö" });
    const res = await submitDraft(draft.id, { confirmed: true, answers: { [form.fields.smokes]: "Ehkä" } });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { [form.fields.smokes]: "invalid_option" });

    const direct = await request(
      "POST",
      "/api/submissions",
      { formTemplateId: form.id, confirmed: true, answers: { [form.fields.name]: "Testi" } },
      userCookie,
    );
    assert.equal(direct.status, 400);
    assert.deepEqual((await direct.json()).fields, { [form.fields.smokes]: "required" });
  });

  test("answers edited after the summary are the ones submitted, once", async () => {
    const before = await submissionCount();
    const draft = await newDraft({ [form.fields.name]: "Vanha Nimi", [form.fields.height]: "170" });

    // The UI sends every current value: an edited name, a cleared optional and a new SELECT.
    const res = await submitDraft(draft.id, {
      answers: { [form.fields.name]: "Uusi Nimi", [form.fields.height]: "", [form.fields.smokes]: "Ei" },
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.id, draft.id);
    assert.equal(submission.status, "SUBMITTED");
    assert.match(submission.referenceCode, /^LA-[2-9A-HJ-NP-Z]{6}$/);

    const rows: { field_id: number; answer_value: string }[] = await pool.query(
      "SELECT field_id, answer_value FROM form_answers WHERE submission_id = ? ORDER BY field_id",
      [draft.id],
    );
    assert.deepEqual(
      rows.map((r) => [r.field_id, r.answer_value]),
      [
        [form.fields.name, "Uusi Nimi"],
        [form.fields.smokes, "Ei"],
      ],
    );

    // A repeated confirm (e.g. double click) does not create a second submission.
    assert.equal((await submitDraft(draft.id, {})).status, 409);
    assert.equal(await submissionCount(), before + 1);
  });

  test("another user cannot open or submit the draft behind a summary", async () => {
    const draft = await newDraft({ [form.fields.name]: "Testi Henkilö", [form.fields.smokes]: "Kyllä" });
    assert.equal((await request("GET", `/api/submissions/${draft.id}`, undefined, otherUserCookie)).status, 404);
    assert.equal((await submitDraft(draft.id, {}, otherUserCookie)).status, 404);
    assert.equal((await request("GET", `/api/submissions/${draft.id}`, undefined, adminCookie)).status, 404);

    const [row] = await pool.query("SELECT status FROM form_submissions WHERE id = ?", [draft.id]);
    assert.equal(row.status, "DRAFT");
  });
});
