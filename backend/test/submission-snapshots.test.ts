// Submission question snapshots (Issue #36). Integration tests against the configured MariaDB
// (synthetic data only). Forms are created and edited through the admin API, so the edits are
// the same ones an administrator can make. Everything created here is deleted afterwards.
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
type Field = { id: number; label: string; fieldType: string; required: boolean; options: string[] | null };

let admin: Account;
let customer: Account;
let otherUser: Account;
let profA: Account;
let profB: Account;

async function request(method: string, path: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function json(res: Response, status = 200) {
  assert.equal(res.status, status, await res.clone().text());
  return res.json();
}

async function createUser(role: Role): Promise<Account> {
  const email = `snapshot-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", undefined, { email, password: PASSWORD });
  assert.equal(res.status, 201);
  const { user } = await res.json();
  await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, user.id]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: user.id };
}

const SELECT_OPTIONS = ["Vaihtoehto A", "Vaihtoehto B", "Vaihtoehto C"];

/** Published form: A (TEXT, required), B (SELECT), C (NUMBER), E (DATE, left unanswered in tests). */
async function createForm() {
  const created = await json(
    await request("POST", "/api/forms", admin.cookie, { name: `Snapshot-testi ${randomUUID()}` }),
    201,
  );
  const id: number = created.template.id;
  createdTemplateIds.push(id);
  for (const field of [
    { label: "Kysymys A", fieldType: "TEXT", required: true },
    { label: "Kysymys B", fieldType: "SELECT", options: SELECT_OPTIONS },
    { label: "Kysymys C", fieldType: "NUMBER" },
    { label: "Kysymys E", fieldType: "DATE" },
  ]) {
    await json(await request("POST", `/api/forms/${id}/fields`, admin.cookie, field), 201);
  }
  const published = await json(await request("POST", `/api/forms/${id}/publish`, admin.cookie));
  const [a, b, c, e]: Field[] = published.template.fields;
  return { id, a, b, c, e };
}

type SnapshotRow = {
  source_field_id: number;
  label: string;
  field_type: string;
  is_required: unknown;
  options: unknown;
  position: number;
};

async function snapshotRows(submissionId: number) {
  const rows: SnapshotRow[] = await pool.query(
    `SELECT source_field_id, label, field_type, is_required, options, position
       FROM submission_field_snapshots WHERE submission_id = ? ORDER BY position`,
    [submissionId],
  );
  return rows.map((row) => ({
    fieldId: row.source_field_id,
    label: row.label,
    fieldType: row.field_type,
    required: Boolean(row.is_required),
    options: typeof row.options === "string" ? JSON.parse(row.options) : row.options,
    position: row.position,
  }));
}

const labels = (submission: { answers: { label: string }[] }) => submission.answers.map((a) => a.label);

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await createUser("ADMIN");
  customer = await createUser("USER");
  otherUser = await createUser("USER");
  profA = await createUser("PROFESSIONAL");
  profB = await createUser("PROFESSIONAL");
  await pool.query("INSERT INTO professional_customer_access (professional_user_id, customer_user_id) VALUES (?, ?)", [
    profA.id,
    customer.id,
  ]);
});

after(async () => {
  // Submissions (with answers and snapshots) cascade with their users; then the templates can go.
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  if (createdTemplateIds.length > 0) {
    await pool.query("DELETE FROM form_templates WHERE id IN (?)", [createdTemplateIds]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("database", () => {
  test("snapshot table cascades with the submission and has unique keys", async () => {
    const fks: { REFERENCED_TABLE_NAME: string; DELETE_RULE: string }[] = await pool.query(
      `SELECT k.REFERENCED_TABLE_NAME, r.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = 'submission_field_snapshots'`,
    );
    // Only the submission; the source field is deliberately not a foreign key.
    assert.deepEqual(
      fks.map((fk) => [fk.REFERENCED_TABLE_NAME, fk.DELETE_RULE]),
      [["form_submissions", "CASCADE"]],
    );
    const indexes: { Key_name: string; Non_unique: unknown }[] = await pool.query("SHOW INDEX FROM submission_field_snapshots");
    for (const key of ["uq_submission_field_snapshots_field", "uq_submission_field_snapshots_position"]) {
      assert.ok(indexes.some((i) => i.Key_name === key && Number(i.Non_unique) === 0), key);
    }
  });

  test("the options check matches form_fields", async () => {
    const form = await createForm();
    const res = await json(
      await request("POST", "/api/submissions", customer.cookie, {
        formTemplateId: form.id,
        answers: { [form.a.id]: "x" },
      }),
      201,
    );
    const id = res.submission.id;
    await assert.rejects(
      pool.query(
        "INSERT INTO submission_field_snapshots (submission_id, source_field_id, label, field_type, is_required, options, position) VALUES (?, 1, 'x', 'SELECT', 0, NULL, 99)",
        [id],
      ),
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO submission_field_snapshots (submission_id, source_field_id, label, field_type, is_required, options, position) VALUES (?, 1, 'x', 'TEXT', 0, '[\"a\"]', 99)",
        [id],
      ),
    );
  });
});

describe("snapshot creation", () => {
  test("a direct submission snapshots every question with type, required flag, options and order", async () => {
    const form = await createForm();
    const res = await json(
      await request("POST", "/api/submissions", customer.cookie, {
        formTemplateId: form.id,
        answers: { [form.a.id]: "Vastaus A", [form.b.id]: "Vaihtoehto B" },
      }),
      201,
    );
    assert.deepEqual(await snapshotRows(res.submission.id), [
      { fieldId: form.a.id, label: "Kysymys A", fieldType: "TEXT", required: true, options: null, position: 1 },
      { fieldId: form.b.id, label: "Kysymys B", fieldType: "SELECT", required: false, options: SELECT_OPTIONS, position: 2 },
      { fieldId: form.c.id, label: "Kysymys C", fieldType: "NUMBER", required: false, options: null, position: 3 },
      { fieldId: form.e.id, label: "Kysymys E", fieldType: "DATE", required: false, options: null, position: 4 },
    ]);
  });

  test("drafts get no snapshot until the final submit", async () => {
    const form = await createForm();
    const draft = await json(
      await request("POST", "/api/submissions/draft", customer.cookie, {
        formTemplateId: form.id,
        answers: { [form.b.id]: "Vaihtoehto C" },
      }),
      201,
    );
    const id = draft.submission.id;
    assert.deepEqual(await snapshotRows(id), []);
    await json(await request("POST", "/api/submissions/draft", customer.cookie, { id, answers: { [form.c.id]: "3" } }));
    assert.deepEqual(await snapshotRows(id), []);

    const submitted = await json(
      await request("POST", `/api/submissions/${id}/submit`, customer.cookie, { answers: { [form.a.id]: "Lopullinen" } }),
    );
    assert.equal(submitted.submission.status, "SUBMITTED");
    assert.deepEqual(labels(submitted.submission), ["Kysymys A", "Kysymys B", "Kysymys C"]);
    assert.deepEqual(
      (await snapshotRows(id)).map((row) => [row.fieldId, row.position]),
      [
        [form.a.id, 1],
        [form.b.id, 2],
        [form.c.id, 3],
        [form.e.id, 4],
      ],
    );
  });

  test("a failed final submit leaves the draft, its answers and no snapshot", async () => {
    const form = await createForm();
    const draft = await json(
      await request("POST", "/api/submissions/draft", customer.cookie, { formTemplateId: form.id, answers: {} }),
      201,
    );
    const id = draft.submission.id;
    // Validation failure: required A is missing.
    await json(await request("POST", `/api/submissions/${id}/submit`, customer.cookie, { answers: { [form.c.id]: "5" } }), 400);
    assert.deepEqual(await snapshotRows(id), []);

    // Failure inside snapshot creation: a conflicting row makes the snapshot insert hit the unique
    // key after the answers were saved. Everything in the transaction must roll back.
    await pool.query(
      "INSERT INTO submission_field_snapshots (submission_id, source_field_id, label, field_type, is_required, position) VALUES (?, ?, 'Ristiriita', 'TEXT', 0, 1)",
      [id, form.a.id],
    );
    const res = await request("POST", `/api/submissions/${id}/submit`, customer.cookie, {
      answers: { [form.a.id]: "Ei saa jäädä" },
    });
    assert.equal(res.status, 500);
    const [row]: { status: string; submitted_at: Date | null }[] = await pool.query(
      "SELECT status, submitted_at FROM form_submissions WHERE id = ?",
      [id],
    );
    assert.deepEqual([row.status, row.submitted_at], ["DRAFT", null]);
    const answers: unknown[] = await pool.query("SELECT 1 FROM form_answers WHERE submission_id = ?", [id]);
    assert.equal(answers.length, 0);
    assert.deepEqual(
      (await snapshotRows(id)).map((r) => r.label),
      ["Ristiriita"],
    );
    await pool.query("DELETE FROM submission_field_snapshots WHERE submission_id = ?", [id]);
  });

  test("deleting a submission deletes its snapshot", async () => {
    const form = await createForm();
    const res = await json(
      await request("POST", "/api/submissions", customer.cookie, { formTemplateId: form.id, answers: { [form.a.id]: "x" } }),
      201,
    );
    const id = res.submission.id;
    assert.equal((await snapshotRows(id)).length, 4);
    await pool.query("DELETE FROM form_submissions WHERE id = ?", [id]);
    assert.deepEqual(await snapshotRows(id), []);
  });
});

describe("historical stability", () => {
  let form: Awaited<ReturnType<typeof createForm>>;
  let oldId: number;
  let before: unknown;
  let snapshotBefore: unknown;
  let d: Field;

  test("an old submission is unchanged after the form is edited in every supported way", async () => {
    form = await createForm();
    const res = await json(
      await request("POST", "/api/submissions", customer.cookie, {
        formTemplateId: form.id,
        answers: { [form.a.id]: "Vastaus A", [form.b.id]: "Vaihtoehto B", [form.c.id]: "12,5" },
      }),
      201,
    );
    oldId = res.submission.id;
    before = (await json(await request("GET", `/api/submissions/${oldId}`, customer.cookie))).submission;
    snapshotBefore = await snapshotRows(oldId);

    const base = `/api/forms/${form.id}`;
    await json(await request("POST", `${base}/unpublish`, admin.cookie));
    // Unpublished: the old submission stays readable with the same questions.
    const unpublished = (await json(await request("GET", `/api/submissions/${oldId}`, customer.cookie))).submission;
    assert.equal(unpublished.formAvailable, false);
    assert.deepEqual(unpublished.answers, (before as { answers: unknown }).answers);

    await json(await request("PATCH", `${base}/fields/${form.a.id}`, admin.cookie, { label: "Kysymys A muutettu", required: false }));
    await json(await request("PATCH", `${base}/fields/${form.b.id}`, admin.cookie, { options: ["Vaihtoehto A", "Vaihtoehto C", "Vaihtoehto D"] }));
    await json(await request("PATCH", `${base}/fields/${form.c.id}`, admin.cookie, { fieldType: "TEXT", required: true }));
    // E was left unanswered, so it can be deleted; answered fields stay protected (409).
    await json(await request("DELETE", `${base}/fields/${form.e.id}`, admin.cookie));
    assert.equal((await request("DELETE", `${base}/fields/${form.a.id}`, admin.cookie)).status, 409);
    const added = await json(await request("POST", `${base}/fields`, admin.cookie, { label: "Kysymys D", fieldType: "TEXT" }), 201);
    d = added.template.fields.find((f: Field) => f.label === "Kysymys D");
    await json(await request("PATCH", base, admin.cookie, { name: `Snapshot-testi muutettu ${randomUUID()}` }));
    await json(await request("PUT", `${base}/fields/order`, admin.cookie, { fieldIds: [form.c.id, form.a.id, form.b.id, d.id] }));
    await json(await request("POST", `${base}/publish`, admin.cookie));

    const after = (await json(await request("GET", `/api/submissions/${oldId}`, customer.cookie))).submission;
    // Questions, types, order, answers and the removed option are as submitted. The form name
    // is not part of the snapshot, so only it may differ.
    assert.deepEqual({ ...after, formName: null }, { ...(before as object), formName: null });
    assert.deepEqual(
      after.answers.map((a: { label: string; fieldType: string; value: string | null }) => [a.label, a.fieldType, a.value]),
      [
        ["Kysymys A", "TEXT", "Vastaus A"],
        ["Kysymys B", "SELECT", "Vaihtoehto B"],
        ["Kysymys C", "NUMBER", "12.5"],
        ["Kysymys E", "DATE", null],
      ],
    );
    assert.deepEqual(await snapshotRows(oldId), snapshotBefore);
  });

  test("an assigned professional sees the same historical questions", async () => {
    const res = await json(
      await request("GET", `/api/professional/customers/${customer.id}/submissions/${oldId}`, profA.cookie),
    );
    assert.deepEqual(res.submission.answers, (before as { answers: unknown }).answers);
  });

  test("a new submission uses the edited form's questions and order", async () => {
    const res = await json(
      await request("POST", "/api/submissions", customer.cookie, {
        formTemplateId: form.id,
        answers: { [form.c.id]: "teksti nyt", [form.b.id]: "Vaihtoehto D" },
      }),
      201,
    );
    const detail = (await json(await request("GET", `/api/submissions/${res.submission.id}`, customer.cookie))).submission;
    assert.deepEqual(labels(detail), ["Kysymys C", "Kysymys A muutettu", "Kysymys B", "Kysymys D"]);
    const rows = await snapshotRows(res.submission.id);
    assert.deepEqual(
      rows.map((r) => [r.fieldId, r.fieldType, r.required, r.position]),
      [
        [form.c.id, "TEXT", true, 1],
        [form.a.id, "TEXT", false, 2],
        [form.b.id, "SELECT", false, 3],
        [d.id, "TEXT", false, 4],
      ],
    );
    assert.deepEqual(rows[2].options, ["Vaihtoehto A", "Vaihtoehto C", "Vaihtoehto D"]);
    // The old submission still has its own snapshot.
    assert.deepEqual(await snapshotRows(oldId), snapshotBefore);
  });
});

describe("authorization is unchanged", () => {
  test("only the owner and an assigned professional can read a submission's questions", async () => {
    const form = await createForm();
    const res = await json(
      await request("POST", "/api/submissions", customer.cookie, { formTemplateId: form.id, answers: { [form.a.id]: "Oma" } }),
      201,
    );
    const id = res.submission.id;
    assert.equal((await request("GET", `/api/submissions/${id}`, otherUser.cookie)).status, 404);
    assert.equal((await request("GET", `/api/submissions/${id}`, profA.cookie)).status, 404);
    assert.equal((await request("GET", `/api/submissions/${id}`, admin.cookie)).status, 404);
    assert.equal((await request("GET", `/api/submissions/${id}`)).status, 401);
    assert.equal((await request("GET", `/api/professional/customers/${customer.id}/submissions/${id}`, profB.cookie)).status, 404);
    assert.equal((await request("GET", `/api/professional/customers/${customer.id}/submissions/${id}`, customer.cookie)).status, 403);
    assert.equal(
      (await request("GET", `/api/professional/customers/${customer.id}/submissions/${id}?submissionId=${id}`, profA.cookie)).status,
      400,
    );
    // Another customer's submission id under the assigned customer's path.
    const other = await json(
      await request("POST", "/api/submissions", otherUser.cookie, { formTemplateId: form.id, answers: { [form.a.id]: "Muu" } }),
      201,
    );
    assert.equal(
      (await request("GET", `/api/professional/customers/${customer.id}/submissions/${other.submission.id}`, profA.cookie)).status,
      404,
    );
  });
});
