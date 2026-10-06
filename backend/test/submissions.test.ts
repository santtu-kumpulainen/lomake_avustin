// Integration tests against the configured MariaDB (synthetic data only).
// Users, templates and submissions created here are deleted afterwards.
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

type Field = { id: number; label: string };
// A published form with one field of each type, a second published form and a draft.
let form: { id: number; name: string; fields: Record<"name" | "height" | "birthDate" | "smokes", number> };
let otherForm: { id: number; fieldId: number };
let draft: { id: number; fieldId: number };

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

async function createUser(role: "ADMIN" | "USER"): Promise<string> {
  const email = `submissions-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  await pool.query("UPDATE users SET role = ? WHERE email = ?", [role, email]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return cookie.split(";")[0];
}

async function createTemplate(fields: Record<string, unknown>[], publish: boolean) {
  let res = await request("POST", "/api/forms", { name: `Testilomake ${randomUUID()}` }, adminCookie);
  assert.equal(res.status, 201);
  const { template } = await res.json();
  createdTemplateIds.push(template.id);
  let saved: Field[] = [];
  for (const field of fields) {
    res = await request("POST", `/api/forms/${template.id}/fields`, field, adminCookie);
    assert.equal(res.status, 201);
    saved = (await res.json()).template.fields;
  }
  if (publish) {
    res = await request("POST", `/api/forms/${template.id}/publish`, undefined, adminCookie);
    assert.equal(res.status, 200);
  }
  return { id: template.id as number, name: template.name as string, fields: saved };
}

function submit(answers: unknown, cookie = userCookie, formTemplateId = form.id) {
  return request("POST", "/api/submissions", { formTemplateId, answers }, cookie);
}

function validAnswers(): Record<string, string> {
  return {
    [form.fields.name]: "Testi Henkilö",
    [form.fields.height]: "172,5",
    [form.fields.birthDate]: "1990-05-17",
    [form.fields.smokes]: "Ei",
  };
}

async function submissionCount(templateId: number): Promise<number> {
  const [row] = await pool.query(
    "SELECT COUNT(*) AS n FROM form_submissions WHERE form_template_id = ?",
    [templateId],
  );
  return Number(row.n);
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminCookie = await createUser("ADMIN");
  userCookie = await createUser("USER");
  otherUserCookie = await createUser("USER");

  const main = await createTemplate(
    [
      { label: "Nimi", fieldType: "TEXT", required: true },
      { label: "Pituus (cm)", fieldType: "NUMBER" },
      { label: "Syntymäaika", fieldType: "DATE", required: true },
      { label: "Tupakoitko?", fieldType: "SELECT", required: true, options: ["Kyllä", "Ei"] },
    ],
    true,
  );
  const [name, height, birthDate, smokes] = main.fields.map((f) => f.id);
  form = { id: main.id, name: main.name, fields: { name, height, birthDate, smokes } };

  const other = await createTemplate([{ label: "Muu", fieldType: "TEXT" }], true);
  otherForm = { id: other.id, fieldId: other.fields[0].id };
  const unpublished = await createTemplate([{ label: "Luonnos", fieldType: "TEXT" }], false);
  draft = { id: unpublished.id, fieldId: unpublished.fields[0].id };
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

describe("available forms", () => {
  test("an authenticated user can list and open published forms", async () => {
    const list = await request("GET", "/api/forms", undefined, userCookie);
    assert.equal(list.status, 200);
    const ids = (await list.json()).templates.map((t: { id: number }) => t.id);
    assert.ok(ids.includes(form.id));
    assert.ok(!ids.includes(draft.id));

    const res = await request("GET", `/api/forms/${form.id}`, undefined, userCookie);
    assert.equal(res.status, 200);
    const { template } = await res.json();
    assert.deepEqual(
      template.fields.map((f: { fieldType: string; required: boolean }) => [f.fieldType, f.required]),
      [["TEXT", true], ["NUMBER", false], ["DATE", true], ["SELECT", true]],
    );
  });

  test("unauthenticated requests get 401", async () => {
    assert.equal((await request("GET", "/api/forms")).status, 401);
    assert.equal((await request("GET", `/api/forms/${form.id}`)).status, 401);
    const res = await request("POST", "/api/submissions", {
      formTemplateId: form.id,
      answers: validAnswers(),
    });
    assert.equal(res.status, 401);
  });

  test("an unpublished form cannot be opened or submitted by a user", async () => {
    assert.equal((await request("GET", `/api/forms/${draft.id}`, undefined, userCookie)).status, 404);
    const res = await submit({ [draft.fieldId]: "x" }, userCookie, draft.id);
    assert.equal(res.status, 404);
    assert.equal(await submissionCount(draft.id), 0);
  });

  test("even ADMIN cannot submit an unpublished form", async () => {
    const res = await submit({ [draft.fieldId]: "x" }, adminCookie, draft.id);
    assert.equal(res.status, 404);
  });
});

describe("submitting", () => {
  test("a valid form is saved as SUBMITTED with a reference code and submitted_at", async () => {
    const res = await submit(validAnswers());
    assert.equal(res.status, 201);
    const { submission } = await res.json();
    assert.equal(submission.status, "SUBMITTED");
    assert.match(submission.referenceCode, /^LA-[2-9A-HJ-NP-Z]{6}$/);
    assert.ok(submission.submittedAt);

    const [row] = await pool.query(
      "SELECT status, reference_code, submitted_at FROM form_submissions WHERE id = ?",
      [submission.id],
    );
    assert.equal(row.status, "SUBMITTED");
    assert.equal(row.reference_code, submission.referenceCode);
    assert.ok(row.submitted_at instanceof Date);

    const answers = await pool.query(
      "SELECT field_id, answer_value FROM form_answers WHERE submission_id = ? ORDER BY field_id",
      [submission.id],
    );
    const byField = Object.fromEntries(answers.map((a: { field_id: number; answer_value: string }) => [a.field_id, a.answer_value]));
    assert.equal(byField[form.fields.name], "Testi Henkilö");
    // Decimal comma is normalized to a dot.
    assert.equal(byField[form.fields.height], "172.5");
    assert.equal(byField[form.fields.birthDate], "1990-05-17");
    assert.equal(byField[form.fields.smokes], "Ei");
  });

  test("an empty optional field is allowed and not stored", async () => {
    const res = await submit({ ...validAnswers(), [form.fields.height]: "" });
    assert.equal(res.status, 201);
    const { submission } = await res.json();
    const answers = await pool.query("SELECT field_id FROM form_answers WHERE submission_id = ?", [
      submission.id,
    ]);
    assert.equal(answers.length, 3);
  });

  test("each submission gets a different reference code", async () => {
    const first = (await (await submit(validAnswers())).json()).submission.referenceCode;
    const second = (await (await submit(validAnswers())).json()).submission.referenceCode;
    assert.notEqual(first, second);
  });
});

describe("validation", () => {
  async function expectErrors(answers: unknown, expected: Record<string, string>) {
    const before = await submissionCount(form.id);
    const res = await submit(answers);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Validation failed");
    assert.deepEqual(body.fields, expected);
    // Invalid data is never saved.
    assert.equal(await submissionCount(form.id), before);
  }

  test("missing and blank required fields return field-level errors", async () => {
    await expectErrors(
      { [form.fields.name]: "   ", [form.fields.height]: "180" },
      {
        [form.fields.name]: "required",
        [form.fields.birthDate]: "required",
        [form.fields.smokes]: "required",
      },
    );
  });

  test("an invalid NUMBER is rejected", async () => {
    for (const value of ["abc", "12a", "1.2.3", "1e5"]) {
      await expectErrors({ ...validAnswers(), [form.fields.height]: value }, {
        [form.fields.height]: "invalid_number",
      });
    }
  });

  test("an invalid DATE is rejected", async () => {
    for (const value of ["17.5.1990", "2026-02-30", "2026-13-01", "huomenna"]) {
      await expectErrors({ ...validAnswers(), [form.fields.birthDate]: value }, {
        [form.fields.birthDate]: "invalid_date",
      });
    }
  });

  test("a SELECT value outside the options is rejected", async () => {
    await expectErrors({ ...validAnswers(), [form.fields.smokes]: "Joskus" }, {
      [form.fields.smokes]: "invalid_option",
    });
  });

  test("an unknown field id is rejected", async () => {
    await expectErrors({ ...validAnswers(), 999999999: "x" }, { 999999999: "unknown_field" });
  });

  test("a field of another template is rejected", async () => {
    await expectErrors(
      { ...validAnswers(), [otherForm.fieldId]: "x" },
      { [otherForm.fieldId]: "unknown_field" },
    );
  });

  test("non-string values and malformed bodies are rejected", async () => {
    await expectErrors({ ...validAnswers(), [form.fields.height]: 172 }, {
      [form.fields.height]: "invalid",
    });
    await expectErrors(["Testi"], { answers: "invalid" });

    const res = await request("POST", "/api/submissions", { answers: validAnswers() }, userCookie);
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { formTemplateId: "required" });
  });
});

describe("ownership", () => {
  test("a user can read their own submission", async () => {
    const { submission } = await (await submit(validAnswers())).json();
    const res = await request("GET", `/api/submissions/${submission.id}`, undefined, userCookie);
    assert.equal(res.status, 200);
    const body = (await res.json()).submission;
    assert.equal(body.referenceCode, submission.referenceCode);
    assert.equal(body.formName, form.name);
    assert.deepEqual(
      body.answers.map((a: { label: string }) => a.label),
      ["Nimi", "Pituus (cm)", "Syntymäaika", "Tupakoitko?"],
    );
  });

  test("another user cannot read or modify the submission", async () => {
    const { submission } = await (await submit(validAnswers())).json();
    const path = `/api/submissions/${submission.id}`;

    assert.equal((await request("GET", path, undefined, otherUserCookie)).status, 404);
    // There is no way to change a submission; write methods are not routed.
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const res = await request(method, path, { answers: {} }, otherUserCookie);
      assert.equal(res.status, 404, method);
    }

    const owner = (await (await request("GET", "/api/auth/me", undefined, userCookie)).json()).user;
    const [row] = await pool.query(
      "SELECT user_id, status FROM form_submissions WHERE id = ?",
      [submission.id],
    );
    assert.equal(row.user_id, owner.id);
    assert.equal(row.status, "SUBMITTED");
    const answers = await pool.query("SELECT COUNT(*) AS n FROM form_answers WHERE submission_id = ?", [
      submission.id,
    ]);
    assert.equal(Number(answers[0].n), 4);
  });
});
