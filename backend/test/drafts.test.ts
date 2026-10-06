// Integration tests against the configured MariaDB (synthetic data only).
// Users, templates and drafts created here are deleted afterwards.
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
let otherUserCookie: string;
let userId: number;

// A published form: required TEXT, optional NUMBER, required DATE, required SELECT.
let form: { id: number; fields: Record<"name" | "height" | "birthDate" | "smokes", number> };

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
  const email = `drafts-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  const { user } = await res.json();
  await pool.query("UPDATE users SET role = ? WHERE email = ?", [role, email]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: user.id };
}

async function createTemplate(fields: Record<string, unknown>[]) {
  let res = await request("POST", "/api/forms", { name: `Testilomake ${randomUUID()}` }, adminCookie);
  const { template } = await res.json();
  createdTemplateIds.push(template.id);
  let saved: { id: number }[] = [];
  for (const field of fields) {
    res = await request("POST", `/api/forms/${template.id}/fields`, field, adminCookie);
    assert.equal(res.status, 201);
    saved = (await res.json()).template.fields;
  }
  res = await request("POST", `/api/forms/${template.id}/publish`, undefined, adminCookie);
  assert.equal(res.status, 200);
  return { id: template.id as number, fieldIds: saved.map((f) => f.id) };
}

function saveDraft(body: unknown, cookie = userCookie) {
  return request("POST", "/api/submissions/draft", body, cookie);
}

async function newDraft(answers: Record<string, string> = {}) {
  const res = await saveDraft({ formTemplateId: form.id, answers });
  assert.equal(res.status, 201);
  return (await res.json()).submission;
}

function submitDraft(id: number, answers?: Record<string, string>, cookie = userCookie) {
  return request("POST", `/api/submissions/${id}/submit`, answers ? { answers } : {}, cookie);
}

async function storedAnswers(submissionId: number) {
  const rows: { field_id: number; answer_value: string }[] = await pool.query(
    "SELECT field_id, answer_value FROM form_answers WHERE submission_id = ? ORDER BY field_id",
    [submissionId],
  );
  return rows;
}

async function storedSubmission(id: number) {
  const [row] = await pool.query(
    "SELECT user_id, status, submitted_at FROM form_submissions WHERE id = ?",
    [id],
  );
  return row;
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

  const template = await createTemplate([
    { label: "Nimi", fieldType: "TEXT", required: true },
    { label: "Pituus (cm)", fieldType: "NUMBER" },
    { label: "Syntymäaika", fieldType: "DATE", required: true },
    { label: "Tupakoitko?", fieldType: "SELECT", required: true, options: ["Kyllä", "Ei"] },
  ]);
  const [name, height, birthDate, smokes] = template.fieldIds;
  form = { id: template.id, fields: { name, height, birthDate, smokes } };
});

after(async () => {
  // Deleting users cascades to their submissions and answers; templates are RESTRICTed until then.
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  if (createdTemplateIds.length > 0) {
    await pool.query("DELETE FROM form_templates WHERE id IN (?)", [createdTemplateIds]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("saving drafts", () => {
  test("an empty draft can be saved and belongs to the user", async () => {
    const draft = await newDraft();
    assert.equal(draft.status, "DRAFT");
    assert.deepEqual(draft.answers, []);
    // A draft is not a receipt yet.
    assert.equal(draft.referenceCode, null);
    assert.equal(draft.submittedAt, null);

    const row = await storedSubmission(draft.id);
    assert.equal(row.user_id, userId);
    assert.equal(row.status, "DRAFT");
    assert.equal(row.submitted_at, null);
  });

  test("a partial draft is saved even though required fields are empty", async () => {
    const draft = await newDraft({ [form.fields.name]: "Testi Henkilö", [form.fields.height]: "172,5" });
    assert.deepEqual(
      draft.answers.map((a: { fieldId: number; value: string }) => [a.fieldId, a.value]),
      [[form.fields.name, "Testi Henkilö"], [form.fields.height, "172.5"]],
    );
  });

  test("a submitted userId is ignored; the owner comes from the session", async () => {
    const res = await saveDraft({ formTemplateId: form.id, answers: {}, userId: 1, user_id: 1 });
    assert.equal(res.status, 201);
    const { submission } = await res.json();
    assert.equal((await storedSubmission(submission.id)).user_id, userId);
  });

  test("draft values are still type-checked", async () => {
    const res = await saveDraft({
      formTemplateId: form.id,
      answers: { [form.fields.height]: "172cm", [form.fields.smokes]: "Joskus", 999999999: "x" },
    });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, {
      [form.fields.height]: "invalid_number",
      [form.fields.smokes]: "invalid_option",
      999999999: "unknown_field",
    });
  });

  test("updating merges answers and never duplicates a field", async () => {
    const draft = await newDraft({ [form.fields.name]: "Vanha nimi", [form.fields.height]: "170" });

    // Change one answer, add one, clear one; the omitted birth date stays empty.
    const res = await saveDraft({
      id: draft.id,
      answers: { [form.fields.name]: "Uusi nimi", [form.fields.smokes]: "Ei", [form.fields.height]: "" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await storedAnswers(draft.id), [
      { field_id: form.fields.name, answer_value: "Uusi nimi" },
      { field_id: form.fields.smokes, answer_value: "Ei" },
    ].sort((a, b) => a.field_id - b.field_id));

    // Saving the same value again does not add rows.
    await saveDraft({ id: draft.id, answers: { [form.fields.name]: "Uusi nimi" } });
    await saveDraft({ id: draft.id, answers: { [form.fields.name]: "Uusi nimi" } });
    const [count] = await pool.query(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT field_id) AS fields FROM form_answers WHERE submission_id = ?",
      [draft.id],
    );
    assert.equal(Number(count.n), 2);
    assert.equal(Number(count.fields), 2);
  });

  test("a draft cannot be moved to another form", async () => {
    const draft = await newDraft();
    const res = await saveDraft({ id: draft.id, formTemplateId: form.id + 1000000, answers: {} });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { formTemplateId: "invalid" });
  });
});

describe("listing and opening drafts", () => {
  test("users list and open only their own drafts", async () => {
    const mine = await newDraft({ [form.fields.name]: "Minun" });
    const theirsRes = await saveDraft({ formTemplateId: form.id, answers: {} }, otherUserCookie);
    const theirs = (await theirsRes.json()).submission;

    const list = await request("GET", "/api/submissions/drafts", undefined, userCookie);
    assert.equal(list.status, 200);
    const { drafts } = await list.json();
    const ids = drafts.map((d: { id: number }) => d.id);
    assert.ok(ids.includes(mine.id));
    assert.ok(!ids.includes(theirs.id));
    const listed = drafts.find((d: { id: number }) => d.id === mine.id);
    assert.equal(listed.answerCount, 1);
    assert.equal(listed.formAvailable, true);

    const own = await request("GET", `/api/submissions/${mine.id}`, undefined, userCookie);
    assert.equal(own.status, 200);
    assert.equal((await own.json()).submission.answers[0].value, "Minun");

    const other = await request("GET", `/api/submissions/${mine.id}`, undefined, otherUserCookie);
    assert.equal(other.status, 404);
  });

  test("another user cannot update or submit the draft", async () => {
    const draft = await newDraft({ [form.fields.name]: "Alkuperäinen" });
    const update = await saveDraft({ id: draft.id, answers: { [form.fields.name]: "Muutettu" } }, otherUserCookie);
    assert.equal(update.status, 404);
    const submit = await submitDraft(draft.id, undefined, otherUserCookie);
    assert.equal(submit.status, 404);

    assert.deepEqual(await storedAnswers(draft.id), [
      { field_id: form.fields.name, answer_value: "Alkuperäinen" },
    ]);
    assert.equal((await storedSubmission(draft.id)).status, "DRAFT");
  });

  test("ADMIN does not get access to a user's draft", async () => {
    const draft = await newDraft();
    const res = await request("GET", `/api/submissions/${draft.id}`, undefined, adminCookie);
    assert.equal(res.status, 404);
  });

  test("unauthenticated requests get 401", async () => {
    const draft = await newDraft();
    assert.equal((await request("GET", "/api/submissions/drafts")).status, 401);
    assert.equal((await request("GET", `/api/submissions/${draft.id}`)).status, 401);
    assert.equal((await request("POST", "/api/submissions/draft", { formTemplateId: form.id })).status, 401);
    assert.equal((await request("POST", `/api/submissions/${draft.id}/submit`, {})).status, 401);
  });
});

describe("submitting drafts", () => {
  test("an incomplete draft is rejected with field errors and stays a DRAFT", async () => {
    const draft = await newDraft({ [form.fields.name]: "Testi Henkilö" });
    const res = await submitDraft(draft.id);
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, {
      [form.fields.birthDate]: "required",
      [form.fields.smokes]: "required",
    });
    const row = await storedSubmission(draft.id);
    assert.equal(row.status, "DRAFT");
    assert.equal(row.submitted_at, null);
  });

  test("answers sent with a failed submit are rolled back too", async () => {
    const draft = await newDraft({ [form.fields.name]: "Testi Henkilö" });
    const res = await submitDraft(draft.id, { [form.fields.height]: "180" });
    assert.equal(res.status, 400);
    assert.deepEqual(await storedAnswers(draft.id), [
      { field_id: form.fields.name, answer_value: "Testi Henkilö" },
    ]);
  });

  test("a complete draft is submitted with submitted_at and a reference code", async () => {
    const draft = await newDraft({ [form.fields.name]: "Testi Henkilö" });
    await saveDraft({ id: draft.id, answers: { [form.fields.birthDate]: "1990-05-17" } });

    // The last missing answer comes with the submit itself.
    const res = await submitDraft(draft.id, { [form.fields.smokes]: "Kyllä" });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.id, draft.id);
    assert.equal(submission.status, "SUBMITTED");
    assert.match(submission.referenceCode, /^LA-[2-9A-HJ-NP-Z]{6}$/);
    assert.ok(submission.submittedAt);
    assert.equal(submission.answers.length, 3);

    const row = await storedSubmission(draft.id);
    assert.equal(row.status, "SUBMITTED");
    assert.ok(row.submitted_at instanceof Date);

    // It is no longer a draft.
    const list = await (await request("GET", "/api/submissions/drafts", undefined, userCookie)).json();
    assert.ok(!list.drafts.some((d: { id: number }) => d.id === draft.id));
  });

  test("a submitted form cannot be changed or submitted again", async () => {
    const draft = await newDraft({
      [form.fields.name]: "Testi Henkilö",
      [form.fields.birthDate]: "1990-05-17",
      [form.fields.smokes]: "Ei",
    });
    assert.equal((await submitDraft(draft.id)).status, 200);

    const update = await saveDraft({ id: draft.id, answers: { [form.fields.name]: "Muutettu" } });
    assert.equal(update.status, 409);
    assert.equal((await submitDraft(draft.id)).status, 409);
    const [name] = await pool.query(
      "SELECT answer_value FROM form_answers WHERE submission_id = ? AND field_id = ?",
      [draft.id, form.fields.name],
    );
    assert.equal(name.answer_value, "Testi Henkilö");
  });
});

describe("unpublished forms", () => {
  test("a draft is kept but cannot change until the form is published again", async () => {
    const template = await createTemplate([{ label: "Kysymys", fieldType: "TEXT", required: true }]);
    const created = await saveDraft({ formTemplateId: template.id, answers: {} });
    const draft = (await created.json()).submission;
    await request("POST", `/api/forms/${template.id}/unpublish`, undefined, adminCookie);

    // Kept and listed, marked unavailable.
    const list = await (await request("GET", "/api/submissions/drafts", undefined, userCookie)).json();
    const listed = list.drafts.find((d: { id: number }) => d.id === draft.id);
    assert.equal(listed.formAvailable, false);

    const update = await saveDraft({ id: draft.id, answers: { [template.fieldIds[0]]: "x" } });
    assert.equal(update.status, 409);
    assert.equal((await submitDraft(draft.id, { [template.fieldIds[0]]: "x" })).status, 409);
    // A new draft for the unpublished form is not possible.
    assert.equal((await saveDraft({ formTemplateId: template.id, answers: {} })).status, 404);

    await request("POST", `/api/forms/${template.id}/publish`, undefined, adminCookie);
    const res = await submitDraft(draft.id, { [template.fieldIds[0]]: "Vastaus" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).submission.status, "SUBMITTED");
  });
});
