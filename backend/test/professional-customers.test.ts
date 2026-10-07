// Controlled professional -> customer access (Issue #32). Integration tests against the
// configured MariaDB (synthetic data only). Professional A is assigned to customer A only;
// customer B and professional B exist to prove that nothing crosses the assignment.
// Everything created here is deleted afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { snapshotFields } from "../src/routes/submissions.js";

const PASSWORD = "testisalasana-123";
const ADMIN_PATH = "/api/admin/professional-customers";
const createdEmails: string[] = [];
const createdTemplateIds: number[] = [];

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

type Role = "USER" | "ADMIN" | "PROFESSIONAL";
type Account = { cookie: string; id: number; email: string };
type Customer = Account & { submissionId: number; draftId: number };

let admin: Account;
let profA: Account;
let profB: Account;
let custA: Customer;
let custB: Customer;
let templateId: number;
let fieldIds: number[];
let assignmentA: number;

async function request(method: string, path: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function createUser(role: Role): Promise<Account> {
  const email = `pca-test-${randomUUID()}@example.test`;
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

async function insertSubmission(userId: number, status: "DRAFT" | "SUBMITTED", answer: string) {
  const code = `LA-T${randomUUID().slice(0, 8).toUpperCase()}`;
  const result = await pool.query(
    `INSERT INTO form_submissions (user_id, form_template_id, status, reference_code, submitted_at)
     VALUES (?, ?, ?, ?, ${status === "SUBMITTED" ? "CURRENT_TIMESTAMP" : "NULL"})`,
    [userId, templateId, status, code],
  );
  const id = Number(result.insertId);
  // Only the second question is answered, so the first comes back empty in form order.
  await pool.query("INSERT INTO form_answers (submission_id, field_id, answer_value) VALUES (?, ?, ?)", [
    id,
    fieldIds[1],
    answer,
  ]);
  // Like the submit routes, a submitted form gets its question snapshot.
  if (status === "SUBMITTED") await snapshotFields(pool, id);
  return id;
}

async function createCustomer(name: string): Promise<Customer> {
  const account = await createUser("USER");
  await pool.query(
    "INSERT INTO user_profiles (user_id, first_name, last_name, date_of_birth, phone) VALUES (?, ?, ?, '1980-05-17', '040 123 4567')",
    [account.id, name, "Testinen"],
  );
  await pool.query("INSERT INTO symptom_descriptions (user_id, description, created_at) VALUES (?, ?, NOW() - INTERVAL 1 DAY)", [
    account.id,
    `${name}: vanhempi kuvaus`,
  ]);
  await pool.query("INSERT INTO symptom_descriptions (user_id, description) VALUES (?, ?)", [
    account.id,
    `${name}: uusin kuvaus`,
  ]);
  const submissionId = await insertSubmission(account.id, "SUBMITTED", `${name} vastaus`);
  const draftId = await insertSubmission(account.id, "DRAFT", `${name} luonnos`);
  return { ...account, submissionId, draftId };
}

async function assign(professionalId: number, customerId: number) {
  return request("POST", ADMIN_PATH, admin.cookie, { professionalId, customerId });
}

async function json(res: Response, status = 200) {
  assert.equal(res.status, status);
  return res.json();
}

const customerPaths = (c: Customer) => [
  `/api/professional/customers/${c.id}`,
  `/api/professional/customers/${c.id}/symptom-descriptions`,
  `/api/professional/customers/${c.id}/submissions`,
  `/api/professional/customers/${c.id}/submissions/${c.submissionId}`,
];

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const template = await pool.query(
    "INSERT INTO form_templates (name, description, status) VALUES (?, ?, 'PUBLISHED')",
    [`Asiakkuustesti ${randomUUID()}`, "Testilomake asiakkuuksille."],
  );
  templateId = Number(template.insertId);
  createdTemplateIds.push(templateId);
  fieldIds = [];
  for (const [position, label] of ["Ensimmäinen kysymys", "Toinen kysymys"].entries()) {
    const field = await pool.query(
      "INSERT INTO form_fields (form_template_id, label, field_type, position) VALUES (?, ?, 'TEXT', ?)",
      [templateId, label, position + 1],
    );
    fieldIds.push(Number(field.insertId));
  }

  admin = await createUser("ADMIN");
  profA = await createUser("PROFESSIONAL");
  profB = await createUser("PROFESSIONAL");
  custA = await createCustomer("Aino");
  custB = await createCustomer("Bertta");

  const created = await json(await assign(profA.id, custA.id), 201);
  assignmentA = created.assignment.id;
});

after(async () => {
  // Assignments, profiles, descriptions and submissions cascade with their users.
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
  test("relationship has foreign keys to users, a unique pair and indexes", async () => {
    const fks: { COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; DELETE_RULE: string }[] = await pool.query(
      `SELECT k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, r.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = 'professional_customer_access'
        ORDER BY k.COLUMN_NAME`,
    );
    assert.deepEqual(
      fks.map((fk) => [fk.COLUMN_NAME, fk.REFERENCED_TABLE_NAME, fk.DELETE_RULE]),
      [
        ["customer_user_id", "users", "CASCADE"],
        ["professional_user_id", "users", "CASCADE"],
      ],
    );
    const indexes: { Key_name: string; Non_unique: unknown; Column_name: string }[] = await pool.query(
      "SHOW INDEX FROM professional_customer_access",
    );
    const unique = indexes.filter((i) => i.Key_name === "uq_professional_customer");
    assert.deepEqual(
      unique.map((i) => [i.Column_name, Number(i.Non_unique)]),
      [
        ["professional_user_id", 0],
        ["customer_user_id", 0],
      ],
    );
    assert.ok(indexes.some((i) => i.Key_name === "idx_professional_customer_customer"));
  });

  test("the database rejects a duplicate pair and a self-assignment", async () => {
    await assert.rejects(
      pool.query("INSERT INTO professional_customer_access (professional_user_id, customer_user_id) VALUES (?, ?)", [
        profA.id,
        custA.id,
      ]),
      { code: "ER_DUP_ENTRY" },
    );
    await assert.rejects(
      pool.query("INSERT INTO professional_customer_access (professional_user_id, customer_user_id) VALUES (?, ?)", [
        profA.id,
        profA.id,
      ]),
    );
  });

  test("deleting either user removes the relationship", async () => {
    const tempProf = await createUser("PROFESSIONAL");
    const tempCust = await createUser("USER");
    await json(await assign(tempProf.id, custA.id), 201);
    await json(await assign(profA.id, tempCust.id), 201);
    await pool.query("DELETE FROM users WHERE id IN (?, ?)", [tempProf.id, tempCust.id]);
    const [row] = await pool.query(
      "SELECT COUNT(*) AS n FROM professional_customer_access WHERE professional_user_id = ? OR customer_user_id = ?",
      [tempProf.id, tempCust.id],
    );
    assert.equal(Number(row.n), 0);
  });
});

describe("admin relationship management", () => {
  test("requires a session and the ADMIN role", async () => {
    const calls = [
      ["GET", ADMIN_PATH],
      ["GET", `${ADMIN_PATH}/options`],
      ["POST", ADMIN_PATH],
      ["DELETE", `${ADMIN_PATH}/${assignmentA}`],
    ] as const;
    for (const [method, path] of calls) {
      const body = method === "POST" ? { professionalId: profB.id, customerId: custB.id } : undefined;
      assert.equal((await request(method, path, undefined, body)).status, 401, `${method} ${path}`);
      for (const account of [custA, profA]) {
        assert.equal((await request(method, path, account.cookie, body)).status, 403, `${method} ${path}`);
      }
    }
    // Nothing was created or removed by the refused calls.
    const { assignments } = await json(await request("GET", ADMIN_PATH, admin.cookie));
    assert.ok(assignments.some((a: { id: number }) => a.id === assignmentA));
    assert.ok(!assignments.some((a: { professional: { id: number } }) => a.professional.id === profB.id));
  });

  test("a professional cannot assign themselves, even claiming another role", async () => {
    for (const body of [
      { professionalId: profA.id, customerId: custB.id },
      { professionalId: profA.id, customerId: custB.id, role: "ADMIN" },
    ]) {
      assert.equal((await request("POST", ADMIN_PATH, profA.cookie, body)).status, 403);
    }
    const [row] = await pool.query(
      "SELECT COUNT(*) AS n FROM professional_customer_access WHERE professional_user_id = ? AND customer_user_id = ?",
      [profA.id, custB.id],
    );
    assert.equal(Number(row.n), 0);
  });

  test("lists assignments with both accounts", async () => {
    const { assignments } = await json(await request("GET", ADMIN_PATH, admin.cookie));
    const mine = assignments.find((a: { id: number }) => a.id === assignmentA);
    assert.deepEqual(mine.professional, { id: profA.id, email: profA.email });
    assert.deepEqual(mine.customer, { id: custA.id, email: custA.email, firstName: "Aino", lastName: "Testinen" });
    assert.ok(mine.createdAt);
  });

  test("options list only professionals and customers", async () => {
    const options = await json(await request("GET", `${ADMIN_PATH}/options`, admin.cookie));
    const professionalIds = options.professionals.map((p: { id: number }) => p.id);
    const customerIds = options.customers.map((c: { id: number }) => c.id);
    assert.ok(professionalIds.includes(profA.id) && professionalIds.includes(profB.id));
    assert.ok(customerIds.includes(custA.id) && customerIds.includes(custB.id));
    for (const id of [admin.id, custA.id]) assert.ok(!professionalIds.includes(id));
    for (const id of [admin.id, profA.id]) assert.ok(!customerIds.includes(id));
  });

  test("rejects missing, invalid and unexpected input", async () => {
    const cases: [unknown, Record<string, string>][] = [
      [{}, { professionalId: "required", customerId: "required" }],
      [{ professionalId: null, customerId: custB.id }, { professionalId: "required" }],
      [{ professionalId: "1", customerId: 1.5 }, { professionalId: "invalid", customerId: "invalid" }],
      [{ professionalId: 0, customerId: -3 }, { professionalId: "invalid", customerId: "invalid" }],
      [
        { professionalId: profB.id, customerId: custB.id, role: "PROFESSIONAL", userId: custB.id },
        { role: "not_allowed", userId: "not_allowed" },
      ],
    ];
    for (const [body, fields] of cases) {
      const res = await request("POST", ADMIN_PATH, admin.cookie, body);
      assert.deepEqual((await json(res, 400)).fields, fields, JSON.stringify(body));
    }
    const query = await request("POST", `${ADMIN_PATH}?professionalId=${profB.id}`, admin.cookie, {
      professionalId: profB.id,
      customerId: custB.id,
    });
    assert.equal(query.status, 400);
  });

  test("rejects nonexistent users and every wrong role combination", async () => {
    const [max] = await pool.query("SELECT MAX(id) AS id FROM users");
    const missing = Number(max.id) + 1000;
    const cases: [number, number, Record<string, string>][] = [
      [missing, custB.id, { professionalId: "not_found" }],
      [profB.id, missing, { customerId: "not_found" }],
      [custA.id, custB.id, { professionalId: "invalid_role" }], // USER as professional
      [admin.id, custB.id, { professionalId: "invalid_role" }], // ADMIN as professional
      [profB.id, profA.id, { customerId: "invalid_role" }], // PROFESSIONAL -> PROFESSIONAL
      [profB.id, admin.id, { customerId: "invalid_role" }], // PROFESSIONAL -> ADMIN
      [custB.id, profB.id, { professionalId: "invalid_role", customerId: "invalid_role" }], // reversed
    ];
    for (const [professionalId, customerId, fields] of cases) {
      const res = await assign(professionalId, customerId);
      assert.deepEqual((await json(res, 400)).fields, fields, `${professionalId} -> ${customerId}`);
    }
    const [row] = await pool.query(
      "SELECT COUNT(*) AS n FROM professional_customer_access WHERE professional_user_id IN (?) OR customer_user_id IN (?)",
      [[custA.id, admin.id, custB.id], [profA.id, admin.id, profB.id]],
    );
    assert.equal(Number(row.n), 0);
  });

  test("rejects a duplicate assignment with 409", async () => {
    const res = await assign(profA.id, custA.id);
    assert.equal(res.status, 409);
  });

  test("creates and removes an assignment", async () => {
    const { assignment } = await json(await assign(profB.id, custB.id), 201);
    assert.deepEqual(assignment, { id: assignment.id, professionalId: profB.id, customerId: custB.id });
    assert.equal((await request("GET", `/api/professional/customers/${custB.id}`, profB.cookie)).status, 200);

    assert.equal((await request("DELETE", `${ADMIN_PATH}/${assignment.id}`, admin.cookie)).status, 204);
    assert.equal((await request("DELETE", `${ADMIN_PATH}/${assignment.id}`, admin.cookie)).status, 404);
    assert.equal((await request("DELETE", `${ADMIN_PATH}/abc`, admin.cookie)).status, 404);
    // Access ends with the assignment.
    assert.equal((await request("GET", `/api/professional/customers/${custB.id}`, profB.cookie)).status, 404);
  });
});

describe("professional customer list", () => {
  test("requires a session and the PROFESSIONAL role", async () => {
    assert.equal((await request("GET", "/api/professional/customers")).status, 401);
    for (const account of [custA, admin]) {
      assert.equal((await request("GET", "/api/professional/customers", account.cookie)).status, 403);
    }
  });

  test("lists only the professional's own assigned customers with minimal fields", async () => {
    const { customers } = await json(await request("GET", "/api/professional/customers", profA.cookie));
    assert.deepEqual(customers, [{ id: custA.id, firstName: "Aino", lastName: "Testinen", dateOfBirth: "1980-05-17" }]);
    const other = await json(await request("GET", "/api/professional/customers", profB.cookie));
    assert.deepEqual(other.customers, []);
  });

  test("query parameters cannot select another professional or customer", async () => {
    for (const query of [`professionalId=${profB.id}`, `userId=${custB.id}`, `customerId=${custB.id}`, "role=ADMIN"]) {
      const res = await request("GET", `/api/professional/customers?${query}`, profA.cookie);
      assert.equal(res.status, 400, query);
    }
  });
});

describe("assigned customer data", () => {
  test("profile is read-only basic information without email", async () => {
    const { customer } = await json(await request("GET", `/api/professional/customers/${custA.id}`, profA.cookie));
    assert.deepEqual(customer, {
      id: custA.id,
      firstName: "Aino",
      lastName: "Testinen",
      dateOfBirth: "1980-05-17",
      phone: "040 123 4567",
    });
    for (const method of ["PUT", "PATCH", "POST", "DELETE"]) {
      const res = await request(method, `/api/professional/customers/${custA.id}`, profA.cookie, { firstName: "X" });
      assert.equal(res.status, 404, method);
    }
    const [profile] = await pool.query("SELECT first_name FROM user_profiles WHERE user_id = ?", [custA.id]);
    assert.equal(profile.first_name, "Aino");
  });

  test("symptom descriptions newest first, description and time only", async () => {
    const path = `/api/professional/customers/${custA.id}/symptom-descriptions`;
    const { symptomDescriptions } = await json(await request("GET", path, profA.cookie));
    assert.deepEqual(
      symptomDescriptions.map((d: { description: string }) => d.description),
      ["Aino: uusin kuvaus", "Aino: vanhempi kuvaus"],
    );
    for (const item of symptomDescriptions) assert.deepEqual(Object.keys(item).sort(), ["createdAt", "description"]);
    assert.equal((await request("POST", path, profA.cookie, { description: "Ammattilaisen kuvaus" })).status, 404);
  });

  test("submissions list contains only submitted forms", async () => {
    const { submissions } = await json(
      await request("GET", `/api/professional/customers/${custA.id}/submissions`, profA.cookie),
    );
    assert.deepEqual(
      submissions.map((s: { id: number }) => s.id),
      [custA.submissionId],
    );
    assert.equal(submissions[0].status, "SUBMITTED");
  });

  test("submission detail has questions in form order, including empty ones", async () => {
    const { submission } = await json(
      await request("GET", `/api/professional/customers/${custA.id}/submissions/${custA.submissionId}`, profA.cookie),
    );
    assert.equal(submission.id, custA.submissionId);
    assert.equal(submission.status, "SUBMITTED");
    assert.match(submission.referenceCode, /^LA-/);
    assert.deepEqual(
      submission.answers.map((a: { fieldId: number; value: string | null }) => [a.fieldId, a.value]),
      [
        [fieldIds[0], null],
        [fieldIds[1], "Aino vastaus"],
      ],
    );
    assert.deepEqual(Object.keys(submission).sort(), [
      "answers",
      "formName",
      "formTemplateId",
      "id",
      "referenceCode",
      "status",
      "submittedAt",
    ]);
  });

  test("the customer's draft is not accessible", async () => {
    const res = await request(
      "GET",
      `/api/professional/customers/${custA.id}/submissions/${custA.draftId}`,
      profA.cookie,
    );
    assert.equal(res.status, 404);
  });
});

describe("IDOR and access denial", () => {
  test("professional A cannot reach customer B in any route", async () => {
    for (const path of customerPaths(custB)) {
      const res = await request("GET", path, profA.cookie);
      assert.equal(res.status, 404, path);
      assert.deepEqual(await res.json(), { error: "Not found" });
    }
    const draft = `/api/professional/customers/${custB.id}/submissions/${custB.draftId}`;
    assert.equal((await request("GET", draft, profA.cookie)).status, 404);
  });

  test("a different professional cannot reach customer A", async () => {
    for (const path of customerPaths(custA)) {
      assert.equal((await request("GET", path, profB.cookie)).status, 404, path);
    }
  });

  test("another customer's submission id under an assigned customer is denied", async () => {
    for (const id of [custB.submissionId, custB.draftId]) {
      const path = `/api/professional/customers/${custA.id}/submissions/${id}`;
      assert.equal((await request("GET", path, profA.cookie)).status, 404, path);
    }
  });

  test("unknown, malformed and non-customer ids get the same 404", async () => {
    for (const id of ["999999999", "abc", "0", "-1", "1.5", String(profA.id), String(admin.id)]) {
      const res = await request("GET", `/api/professional/customers/${id}`, profA.cookie);
      assert.equal(res.status, 404, id);
    }
  });

  test("query parameters are rejected on every customer route", async () => {
    for (const path of customerPaths(custA)) {
      for (const query of [`userId=${custB.id}`, `professionalId=${profB.id}`, `customerId=${custB.id}`]) {
        assert.equal((await request("GET", `${path}?${query}`, profA.cookie)).status, 400, `${path}?${query}`);
      }
    }
    // A parameter never widens access to an unassigned customer either.
    const res = await request("GET", `/api/professional/customers/${custB.id}?professionalId=${profB.id}`, profA.cookie);
    assert.equal(res.status, 400);
  });

  test("USER, ADMIN and anonymous callers cannot use customer routes", async () => {
    for (const path of customerPaths(custA)) {
      assert.equal((await request("GET", path)).status, 401, path);
      for (const account of [custA, custB, admin]) {
        assert.equal((await request("GET", path, account.cookie)).status, 403, path);
      }
    }
  });

  test("existing customer routes stay owner-only for professionals", async () => {
    assert.equal((await request("GET", "/api/profile", profA.cookie)).status, 403);
    assert.equal((await request("GET", "/api/symptom-descriptions", profA.cookie)).status, 403);
    assert.equal((await request("GET", `/api/submissions/${custA.submissionId}`, profA.cookie)).status, 404);
    const own = await json(await request("GET", "/api/submissions", profA.cookie));
    assert.deepEqual(own.submissions, []);
  });

  test("an assignment stops granting access when a role changes", async () => {
    // Customer promoted to staff: no longer a customer.
    await pool.query("UPDATE users SET role = 'PROFESSIONAL' WHERE id = ?", [custA.id]);
    try {
      assert.equal((await request("GET", `/api/professional/customers/${custA.id}`, profA.cookie)).status, 404);
      const { customers } = await json(await request("GET", "/api/professional/customers", profA.cookie));
      assert.deepEqual(customers, []);
    } finally {
      await pool.query("UPDATE users SET role = 'USER' WHERE id = ?", [custA.id]);
    }
    // Professional demoted to USER: the role check refuses before the relationship is used.
    await pool.query("UPDATE users SET role = 'USER' WHERE id = ?", [profA.id]);
    try {
      assert.equal((await request("GET", `/api/professional/customers/${custA.id}`, profA.cookie)).status, 403);
    } finally {
      await pool.query("UPDATE users SET role = 'PROFESSIONAL' WHERE id = ?", [profA.id]);
    }
    assert.equal((await request("GET", `/api/professional/customers/${custA.id}`, profA.cookie)).status, 200);
  });
});
