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

type Role = "USER" | "ADMIN" | "PROFESSIONAL";
type TestUser = { cookie: string; id: number };

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
let admin: TestUser;
let userA: TestUser;
let userB: TestUser;
let professional: TestUser;

// The form being prefilled: TEXT, NUMBER, DATE and an optional SELECT.
let form: { id: number; fields: Record<"duration" | "pain" | "started" | "fever", number> };
// An unrelated form, so its answers must never show up for `form`.
let otherForm: { id: number; fieldId: number };

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

async function createUser(role: Role): Promise<TestUser> {
  const email = `prefill-test-${randomUUID()}@example.test`;
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
  let res = await request("POST", "/api/forms", { name: `Testilomake ${randomUUID()}` }, admin.cookie);
  const { template } = await res.json();
  createdTemplateIds.push(template.id);
  let saved: { id: number }[] = [];
  for (const field of fields) {
    res = await request("POST", `/api/forms/${template.id}/fields`, field, admin.cookie);
    assert.equal(res.status, 201);
    saved = (await res.json()).template.fields;
  }
  res = await request("POST", `/api/forms/${template.id}/publish`, undefined, admin.cookie);
  assert.equal(res.status, 200);
  return { id: template.id as number, fieldIds: saved.map((f) => f.id) };
}

async function submit(user: TestUser, templateId: number, answers: Record<string, string>) {
  const res = await request("POST", "/api/submissions", { formTemplateId: templateId, answers }, user.cookie);
  assert.equal(res.status, 201);
  return (await res.json()).submission as { id: number };
}

function available(user: TestUser | undefined, query: string) {
  return request("GET", `/api/submissions/previous-data/available?${query}`, undefined, user?.cookie);
}

function previousData(user: TestUser | undefined, query: string) {
  return request("GET", `/api/submissions/previous-data?${query}`, undefined, user?.cookie);
}

async function previousValues(user: TestUser, templateId = form.id) {
  const res = await previousData(user, `formTemplateId=${templateId}`);
  assert.equal(res.status, 200);
  const { previousData: data } = await res.json();
  return Object.fromEntries(
    (data.answers as { fieldId: number; value: string }[]).map((a) => [a.fieldId, a.value]),
  );
}

async function storedAnswers(submissionId: number) {
  const rows: { field_id: number; answer_value: string }[] = await pool.query(
    "SELECT field_id, answer_value FROM form_answers WHERE submission_id = ?",
    [submissionId],
  );
  return Object.fromEntries(rows.map((row) => [row.field_id, row.answer_value]));
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await createUser("ADMIN");
  userA = await createUser("USER");
  userB = await createUser("USER");
  professional = await createUser("PROFESSIONAL");

  const template = await createTemplate([
    { label: "Oireiden kesto", fieldType: "TEXT", required: true },
    { label: "Tämänhetkinen kipu (0-10)", fieldType: "NUMBER", required: true },
    { label: "Oireet alkoivat", fieldType: "DATE" },
    { label: "Kuumetta?", fieldType: "SELECT", options: ["Kyllä", "Ei"] },
  ]);
  const [duration, pain, started, fever] = template.fieldIds;
  form = { id: template.id, fields: { duration, pain, started, fever } };

  const other = await createTemplate([{ label: "Lääkitys", fieldType: "TEXT", required: true }]);
  otherForm = { id: other.id, fieldId: other.fieldIds[0] };

  // User B's private history, which nobody else may receive.
  await submit(userB, form.id, {
    [form.fields.duration]: "B:n salainen vastaus",
    [form.fields.pain]: "9",
  });
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

describe("access", () => {
  test("unauthenticated requests are rejected", async () => {
    assert.equal((await available(undefined, `formTemplateId=${form.id}`)).status, 401);
    assert.equal((await previousData(undefined, `formTemplateId=${form.id}`)).status, 401);
  });

  test("a user without own submissions gets nothing, not another user's data", async () => {
    const res = await available(userA, `formTemplateId=${form.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { available: false, fieldCount: 0 });
    assert.deepEqual(await previousValues(userA), {});
  });

  test("ADMIN and PROFESSIONAL only ever get their own data", async () => {
    for (const user of [admin, professional]) {
      assert.deepEqual(await previousValues(user), {});
      const body = await (await available(user, `formTemplateId=${form.id}`)).json();
      assert.equal(body.available, false);
    }
  });

  test("a userId in the query is rejected", async () => {
    for (const query of [
      `formTemplateId=${form.id}&userId=${userB.id}`,
      `formTemplateId=${form.id}&user_id=${userB.id}`,
    ]) {
      for (const call of [available, previousData]) {
        const res = await call(userA, query);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.match(JSON.stringify(body.fields), /not_allowed/);
        assert.doesNotMatch(JSON.stringify(body), /salainen/);
      }
    }
  });

  test("formTemplateId is required and validated", async () => {
    let res = await previousData(userA, "");
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { formTemplateId: "required" });
    res = await previousData(userA, "formTemplateId=abc");
    assert.deepEqual((await res.json()).fields, { formTemplateId: "invalid" });
  });

  test("missing and unpublished forms are 404", async () => {
    assert.equal((await previousData(userA, "formTemplateId=4294967295")).status, 404);
    const hidden = await createTemplate([{ label: "Piilotettu", fieldType: "TEXT" }]);
    await request("POST", `/api/forms/${hidden.id}/unpublish`, undefined, admin.cookie);
    assert.equal((await previousData(userA, `formTemplateId=${hidden.id}`)).status, 404);
    assert.equal((await available(admin, `formTemplateId=${hidden.id}`)).status, 404);
  });
});

describe("matching", () => {
  let firstSubmissionId: number;

  test("drafts are never used as previous data", async () => {
    const res = await request(
      "POST",
      "/api/submissions/draft",
      { formTemplateId: form.id, answers: { [form.fields.duration]: "Luonnoksen arvo" } },
      userA.cookie,
    );
    assert.equal(res.status, 201);
    assert.deepEqual(await (await available(userA, `formTemplateId=${form.id}`)).json(), {
      available: false,
      fieldCount: 0,
    });
    assert.deepEqual(await previousValues(userA), {});
  });

  test("the user's own submitted answers are returned", async () => {
    firstSubmissionId = (
      await submit(userA, form.id, {
        [form.fields.duration]: "5 päivää",
        [form.fields.pain]: "7",
        [form.fields.started]: "2026-10-01",
      })
    ).id;

    const res = await available(userA, `formTemplateId=${form.id}`);
    assert.deepEqual(await res.json(), { available: true, fieldCount: 3 });

    const full = await (await previousData(userA, `formTemplateId=${form.id}`)).json();
    assert.ok(full.previousData.submittedAt);
    // Only field ids and values; no reference codes or other history.
    assert.deepEqual(Object.keys(full.previousData).sort(), ["answers", "submittedAt"]);
    assert.deepEqual(await previousValues(userA), {
      [form.fields.duration]: "5 päivää",
      [form.fields.pain]: "7",
      [form.fields.started]: "2026-10-01",
    });
  });

  test("answers to other forms are not returned", async () => {
    await submit(userA, otherForm.id, { [otherForm.fieldId]: "Ei lääkitystä" });
    const values = await previousValues(userA);
    assert.equal(values[otherForm.fieldId], undefined);
    assert.deepEqual(Object.keys(values).map(Number).sort(), [
      form.fields.duration,
      form.fields.pain,
      form.fields.started,
    ].sort());
    assert.deepEqual(await previousValues(userA, otherForm.id), { [otherForm.fieldId]: "Ei lääkitystä" });
  });

  test("an edited prefilled value is a new submission; the old one is unchanged", async () => {
    const before = await storedAnswers(firstSubmissionId);
    const prefilled = await previousValues(userA);

    const second = await submit(userA, form.id, { ...prefilled, [form.fields.pain]: "3" });
    assert.notEqual(second.id, firstSubmissionId);

    assert.deepEqual(await storedAnswers(firstSubmissionId), before);
    assert.equal((await storedAnswers(firstSubmissionId))[form.fields.pain], "7");
    assert.equal((await storedAnswers(second.id))[form.fields.pain], "3");
    // The latest submission is now the source.
    assert.equal((await previousValues(userA))[form.fields.pain], "3");
  });

  test("values that no longer fit the field are left out", async () => {
    const template = await createTemplate([
      { label: "Valinta", fieldType: "SELECT", options: ["A", "B"] },
      { label: "Teksti", fieldType: "TEXT" },
    ]);
    const [choice, text] = template.fieldIds;
    await submit(userA, template.id, { [choice]: "B", [text]: "säilyy" });

    // The admin removes option B; the old answer would now fail validation.
    await request("POST", `/api/forms/${template.id}/unpublish`, undefined, admin.cookie);
    const res = await request(
      "PATCH",
      `/api/forms/${template.id}/fields/${choice}`,
      { options: ["A", "C"] },
      admin.cookie,
    );
    assert.equal(res.status, 200);
    await request("POST", `/api/forms/${template.id}/publish`, undefined, admin.cookie);

    assert.deepEqual(await previousValues(userA, template.id), { [text]: "säilyy" });
  });
});

describe("drafts", () => {
  test("reading previous data does not change an existing draft, and resuming restores it", async () => {
    const created = await request(
      "POST",
      "/api/submissions/draft",
      { formTemplateId: form.id, answers: { [form.fields.pain]: "1" } },
      userA.cookie,
    );
    const draft = (await created.json()).submission;
    const before = await storedAnswers(draft.id);

    await previousData(userA, `formTemplateId=${form.id}`);
    await available(userA, `formTemplateId=${form.id}`);

    assert.deepEqual(await storedAnswers(draft.id), before);
    const resumed = await (await request("GET", `/api/submissions/${draft.id}`, undefined, userA.cookie)).json();
    assert.equal(resumed.submission.status, "DRAFT");
    assert.deepEqual(
      resumed.submission.answers.map((a: { fieldId: number; value: string }) => [a.fieldId, a.value]),
      [[form.fields.pain, "1"]],
    );
  });
});
