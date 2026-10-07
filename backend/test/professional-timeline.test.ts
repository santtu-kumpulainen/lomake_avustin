// Professional customer timeline (Issue #34). Integration tests against the configured MariaDB
// (synthetic data only). Every event has a fixed timestamp so the expected order is exact.
// Professional A is assigned to customer A and the single-kind customers; professional B only to
// customer B. Everything created here is deleted afterwards.
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

type Role = "USER" | "ADMIN" | "PROFESSIONAL";
type Account = { cookie: string; id: number };

let admin: Account;
let profA: Account;
let profB: Account;
let custA: Account;
let custB: Account;
let onlyDescriptions: Account;
let onlySubmissions: Account;
let noEvents: Account;
let formA: { id: number; name: string; fieldIds: number[] };
let formB: { id: number; name: string; fieldIds: number[] };
// Ids of customer A's submissions by label, for the expected order.
const subs: Record<string, number> = {};

async function request(path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

const timelinePath = (customer: Pick<Account, "id">) => `/api/professional/customers/${customer.id}/timeline`;

async function timeline(customer: Account, professional: Account) {
  const res = await request(timelinePath(customer), professional.cookie);
  assert.equal(res.status, 200);
  return (await res.json()).timeline as Record<string, unknown>[];
}

async function createUser(role: Role): Promise<Account> {
  const email = `timeline-test-${randomUUID()}@example.test`;
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
  return { cookie: cookie.split(";")[0], id: user.id };
}

async function createForm(label: string, fieldCount: number) {
  const name = `Aikajanatesti ${label} ${randomUUID()}`;
  const template = await pool.query("INSERT INTO form_templates (name, status) VALUES (?, 'PUBLISHED')", [name]);
  const id = Number(template.insertId);
  createdTemplateIds.push(id);
  const fieldIds: number[] = [];
  for (let position = 1; position <= fieldCount; position++) {
    const field = await pool.query(
      "INSERT INTO form_fields (form_template_id, label, field_type, position) VALUES (?, ?, 'TEXT', ?)",
      [id, `Kysymys ${position}`, position],
    );
    fieldIds.push(Number(field.insertId));
  }
  return { id, name, fieldIds };
}

async function addDescription(userId: number, description: string, at: string) {
  await pool.query("INSERT INTO symptom_descriptions (user_id, description, created_at) VALUES (?, ?, ?)", [
    userId,
    description,
    at,
  ]);
}

async function addSubmission(
  userId: number,
  form: typeof formA,
  status: "DRAFT" | "SUBMITTED",
  at: string,
  answerCount: number,
) {
  const result = await pool.query(
    `INSERT INTO form_submissions (user_id, form_template_id, status, reference_code, created_at, updated_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, form.id, status, `LA-T${randomUUID().slice(0, 8).toUpperCase()}`, at, at, status === "SUBMITTED" ? at : null],
  );
  const id = Number(result.insertId);
  for (const fieldId of form.fieldIds.slice(0, answerCount)) {
    await pool.query("INSERT INTO form_answers (submission_id, field_id, answer_value) VALUES (?, ?, ?)", [
      id,
      fieldId,
      "vastaus",
    ]);
  }
  return id;
}

async function assign(professional: Account, customer: Account) {
  await pool.query("INSERT INTO professional_customer_access (professional_user_id, customer_user_id) VALUES (?, ?)", [
    professional.id,
    customer.id,
  ]);
}

/** Compact, comparable form of an event; timestamps are checked separately. */
const summary = (event: Record<string, unknown>) =>
  event.type === "SUBMISSION" ? `S:${event.submissionId}` : `D:${event.description}`;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  formA = await createForm("A", 3);
  formB = await createForm("B", 2);

  admin = await createUser("ADMIN");
  profA = await createUser("PROFESSIONAL");
  profB = await createUser("PROFESSIONAL");
  custA = await createUser("USER");
  custB = await createUser("USER");
  onlyDescriptions = await createUser("USER");
  onlySubmissions = await createUser("USER");
  noEvents = await createUser("USER");

  // Inserted out of order on purpose, so insertion order cannot pass for time order.
  await addDescription(custA.id, "A: uudempi kuvaus", "2026-09-03 10:00:00");
  subs.older = await addSubmission(custA.id, formA, "SUBMITTED", "2026-09-02 10:00:00", 3);
  await addDescription(custA.id, "A: vanhempi kuvaus", "2026-09-01 10:00:00");
  subs.newer = await addSubmission(custA.id, formB, "SUBMITTED", "2026-09-04 10:00:00", 1);
  // Three events in the same second.
  await addDescription(custA.id, "A: sama hetki 1", "2026-09-05 12:00:00");
  subs.same = await addSubmission(custA.id, formA, "SUBMITTED", "2026-09-05 12:00:00", 2);
  await addDescription(custA.id, "A: sama hetki 2", "2026-09-05 12:00:00");
  // Newest of all by time, but a draft.
  subs.draft = await addSubmission(custA.id, formA, "DRAFT", "2026-09-20 10:00:00", 1);

  await addDescription(custB.id, "B: kuvaus", "2026-09-06 10:00:00");
  subs.b = await addSubmission(custB.id, formA, "SUBMITTED", "2026-09-06 11:00:00", 1);

  await addDescription(onlyDescriptions.id, "Vain kuvaus 1", "2026-08-01 08:00:00");
  await addDescription(onlyDescriptions.id, "Vain kuvaus 2", "2026-08-02 08:00:00");
  subs.only1 = await addSubmission(onlySubmissions.id, formA, "SUBMITTED", "2026-08-01 08:00:00", 1);
  subs.only2 = await addSubmission(onlySubmissions.id, formB, "SUBMITTED", "2026-08-03 08:00:00", 2);

  // Staff accounts' own activity must never show up in a customer's timeline.
  await addDescription(profA.id, "Ammattilaisen oma kuvaus", "2026-09-30 10:00:00");
  await addSubmission(profA.id, formA, "SUBMITTED", "2026-09-30 10:00:00", 1);

  await assign(profA, custA);
  await assign(profA, onlyDescriptions);
  await assign(profA, onlySubmissions);
  await assign(profA, noEvents);
  await assign(profB, custB);
});

after(async () => {
  // Assignments, descriptions, submissions and answers cascade with their users.
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  if (createdTemplateIds.length > 0) {
    await pool.query("DELETE FROM form_templates WHERE id IN (?)", [createdTemplateIds]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("authentication and role", () => {
  test("signed out is 401, USER and ADMIN are 403", async () => {
    assert.equal((await request(timelinePath(custA))).status, 401);
    assert.equal((await request(timelinePath(custA), custA.cookie)).status, 403);
    assert.equal((await request(timelinePath(custA), admin.cookie)).status, 403);
  });

  test("an assigned professional is allowed", async () => {
    assert.equal((await request(timelinePath(custA), profA.cookie)).status, 200);
  });
});

describe("assignment and IDOR", () => {
  test("each professional sees only their own assigned customer", async () => {
    assert.equal((await request(timelinePath(custB), profA.cookie)).status, 404);
    assert.equal((await request(timelinePath(custB), profB.cookie)).status, 200);
    assert.equal((await request(timelinePath(custA), profB.cookie)).status, 404);
  });

  test("unknown, malformed and staff ids get the same 404", async () => {
    for (const id of ["999999999", "abc", "0", "-1", "1.5", String(profA.id), String(admin.id)]) {
      const res = await request(`/api/professional/customers/${id}/timeline`, profA.cookie);
      assert.equal(res.status, 404, id);
      assert.deepEqual(await res.json(), { error: "Not found" });
    }
  });

  test("query parameters cannot select another customer or professional", async () => {
    for (const query of [`userId=${custB.id}`, `customerId=${custB.id}`, `professionalId=${profB.id}`]) {
      const own = await request(`${timelinePath(custA)}?${query}`, profA.cookie);
      assert.equal(own.status, 400, query);
      const other = await request(`${timelinePath(custB)}?${query}`, profA.cookie);
      assert.notEqual(other.status, 200, query);
    }
  });

  test("losing the assignment removes access", async () => {
    const temp = await createUser("USER");
    await addDescription(temp.id, "Väliaikainen", "2026-09-01 10:00:00");
    await assign(profA, temp);
    assert.equal((await request(timelinePath(temp), profA.cookie)).status, 200);
    await pool.query("DELETE FROM professional_customer_access WHERE customer_user_id = ?", [temp.id]);
    assert.equal((await request(timelinePath(temp), profA.cookie)).status, 404);
  });
});

describe("timeline content", () => {
  test("events newest first with a deterministic order for equal timestamps", async () => {
    const events = await timeline(custA, profA);
    // Same second: the submission first, then descriptions by id, newest id first.
    assert.deepEqual(events.map(summary), [
      `S:${subs.same}`,
      "D:A: sama hetki 2",
      "D:A: sama hetki 1",
      `S:${subs.newer}`,
      "D:A: uudempi kuvaus",
      `S:${subs.older}`,
      "D:A: vanhempi kuvaus",
    ]);
    const times = events.map((event) => Date.parse(event.occurredAt as string));
    assert.ok(times.every((time) => !Number.isNaN(time)));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  });

  test("the order is stable across requests", async () => {
    const first = (await timeline(custA, profA)).map(summary);
    const second = (await timeline(custA, profA)).map(summary);
    assert.deepEqual(second, first);
  });

  test("events carry only the fields the page needs", async () => {
    const events = await timeline(custA, profA);
    const submission = events.find((event) => event.submissionId === subs.older);
    assert.deepEqual(Object.keys(submission!).sort(), ["answerCount", "formName", "occurredAt", "submissionId", "type"]);
    assert.equal(submission!.formName, formA.name);
    assert.equal(submission!.answerCount, 3);
    assert.equal(events.find((event) => event.submissionId === subs.newer)!.answerCount, 1);

    const description = events.find((event) => event.type === "SYMPTOM_DESCRIPTION");
    assert.deepEqual(Object.keys(description!).sort(), ["description", "occurredAt", "type"]);
  });

  test("drafts never appear", async () => {
    const events = await timeline(custA, profA);
    assert.equal(events.filter((event) => event.type === "SUBMISSION").length, 3);
    assert.ok(!events.some((event) => event.submissionId === subs.draft));
  });

  test("customers' data never mix and staff activity never appears", async () => {
    const a = JSON.stringify(await timeline(custA, profA));
    const b = await timeline(custB, profB);
    assert.deepEqual(b.map(summary), [`S:${subs.b}`, "D:B: kuvaus"]);
    assert.ok(!a.includes("B: kuvaus"));
    assert.ok(!a.includes(`"submissionId":${subs.b}`));
    assert.ok(!JSON.stringify(b).includes("A: "));
    for (const body of [a, JSON.stringify(b)]) {
      assert.ok(!body.includes("Ammattilaisen oma kuvaus"));
    }
  });

  test("only descriptions", async () => {
    const events = await timeline(onlyDescriptions, profA);
    assert.deepEqual(events.map(summary), ["D:Vain kuvaus 2", "D:Vain kuvaus 1"]);
  });

  test("only submissions", async () => {
    const events = await timeline(onlySubmissions, profA);
    assert.deepEqual(events.map(summary), [`S:${subs.only2}`, `S:${subs.only1}`]);
    assert.deepEqual(
      events.map((event) => [event.formName, event.answerCount]),
      [
        [formB.name, 2],
        [formA.name, 1],
      ],
    );
  });

  test("no events is an empty list, not an error", async () => {
    assert.deepEqual(await timeline(noEvents, profA), []);
  });

  test("timeline submission ids open the existing professional submission detail", async () => {
    const res = await request(`/api/professional/customers/${custA.id}/submissions/${subs.newer}`, profA.cookie);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).submission.formName, formB.name);
  });
});
