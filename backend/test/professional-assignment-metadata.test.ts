// Assignment metadata (Issue #38): creator, purpose and expiry of professional -> customer
// assignments, and that an expired assignment grants nothing. Integration tests against the
// configured MariaDB (synthetic data only). Everything created here is deleted afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

const PASSWORD = "testisalasana-123";
const ADMIN_PATH = "/api/admin/professional-customers";
const createdEmails: string[] = [];

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

type Role = "USER" | "ADMIN" | "PROFESSIONAL";
type Account = { cookie: string; id: number; email: string };

let admin: Account;
let prof: Account;
let otherProf: Account;
let user: Account;

async function request(method: string, path: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function createUser(role: Role, name?: string): Promise<Account> {
  const email = `pcm-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.equal(res.status, 201);
  const { user: created } = await res.json();
  await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, created.id]);
  if (name) {
    await pool.query("INSERT INTO user_profiles (user_id, first_name, last_name) VALUES (?, ?, 'Testinen')", [
      created.id,
      name,
    ]);
  }
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: created.id, email };
}

async function json(res: Response, status = 200) {
  assert.equal(res.status, status);
  return res.json();
}

/** The same instant written with a +03:00 offset (Finnish summer time), whole seconds. */
function withOffset(date: Date) {
  const shifted = new Date(date.getTime() + 3 * 3600_000);
  return `${shifted.toISOString().slice(0, 19)}+03:00`;
}

const inHours = (hours: number) => new Date(Math.floor(Date.now() / 1000) * 1000 + hours * 3600_000);

async function listed(id: number) {
  const { assignments } = await json(await request("GET", ADMIN_PATH, admin.cookie));
  return assignments.find((a: { id: number }) => a.id === id);
}

async function stored(id: number) {
  const [row] = await pool.query(
    `SELECT created_by_user_id, purpose, expires_at, expires_at > NOW() AS active,
            TIMESTAMPDIFF(MINUTE, NOW(), expires_at) AS minutes_left
       FROM professional_customer_access WHERE id = ?`,
    [id],
  );
  return row;
}

const customerPaths = (customerId: number) => [
  `/api/professional/customers/${customerId}`,
  `/api/professional/customers/${customerId}/symptom-descriptions`,
  `/api/professional/customers/${customerId}/submissions`,
  `/api/professional/customers/${customerId}/timeline`,
];

async function assignedIds(account: Account) {
  const { customers } = await json(await request("GET", "/api/professional/customers", account.cookie));
  return customers.map((c: { id: number }) => c.id);
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await createUser("ADMIN");
  prof = await createUser("PROFESSIONAL");
  otherProf = await createUser("PROFESSIONAL");
  user = await createUser("USER", "Ulla");
});

after(async () => {
  // Assignments and profiles cascade with their users.
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("assignment creation", () => {
  test("ADMIN creates an assignment with purpose and expiry; the creator comes from the session", async () => {
    const customer = await createUser("USER", "Aili");
    const expires = inHours(48);
    const { assignment } = await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        purpose: "  Kivun seurannan hoitojakso  ",
        expiresAt: withOffset(expires),
      }),
      201,
    );
    assert.equal(assignment.purpose, "Kivun seurannan hoitojakso");
    // The offset is honoured: the same instant comes back, whatever time zone it was written in.
    assert.equal(new Date(assignment.expiresAt).toISOString(), expires.toISOString());

    const row = await stored(assignment.id);
    assert.equal(row.created_by_user_id, admin.id);
    assert.equal(row.purpose, "Kivun seurannan hoitojakso");
    // Stored in database time: NOW() sees about 48 hours left.
    assert.equal(Number(row.active), 1);
    assert.ok(Math.abs(Number(row.minutes_left) - 48 * 60) <= 1, String(row.minutes_left));
  });

  test("purpose and expiry are optional; blank purpose is stored as NULL", async () => {
    const customer = await createUser("USER");
    const { assignment } = await json(
      await request("POST", ADMIN_PATH, admin.cookie, { professionalId: prof.id, customerId: customer.id, purpose: "   " }),
      201,
    );
    assert.equal(assignment.purpose, null);
    assert.equal(assignment.expiresAt, null);
    const row = await stored(assignment.id);
    assert.equal(row.purpose, null);
    assert.equal(row.expires_at, null);
    assert.equal(row.created_by_user_id, admin.id);
  });

  test("the client cannot set or override the creator", async () => {
    const customer = await createUser("USER");
    for (const key of ["createdBy", "created_by", "createdByUserId", "created_by_user_id", "createdAt"]) {
      const res = await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        [key]: otherProf.id,
      });
      assert.deepEqual((await json(res, 400)).fields, { [key]: "not_allowed" }, key);
    }
    const [row] = await pool.query("SELECT COUNT(*) AS n FROM professional_customer_access WHERE customer_user_id = ?", [
      customer.id,
    ]);
    assert.equal(Number(row.n), 0);
  });

  test("USER and PROFESSIONAL cannot create, even with metadata or a creator", async () => {
    const customer = await createUser("USER");
    const body = {
      professionalId: prof.id,
      customerId: customer.id,
      purpose: "Oma liitos",
      expiresAt: withOffset(inHours(1)),
    };
    assert.equal((await request("POST", ADMIN_PATH, undefined, body)).status, 401);
    for (const account of [user, prof]) {
      assert.equal((await request("POST", ADMIN_PATH, account.cookie, body)).status, 403);
      assert.equal(
        (await request("POST", ADMIN_PATH, account.cookie, { ...body, createdBy: admin.id })).status,
        403,
      );
    }
    const [row] = await pool.query("SELECT COUNT(*) AS n FROM professional_customer_access WHERE customer_user_id = ?", [
      customer.id,
    ]);
    assert.equal(Number(row.n), 0);
  });

  test("rejects an invalid or too long purpose", async () => {
    const customer = await createUser("USER");
    const cases: [unknown, string][] = [
      [123, "invalid"],
      [["Hoito"], "invalid"],
      [{ text: "Hoito" }, "invalid"],
      ["Rivi 1\nRivi 2", "invalid"],
      ["Sarkain\tteksti", "invalid"],
      ["x".repeat(301), "too_long"],
      [` ${"x".repeat(301)} `, "too_long"],
    ];
    for (const [purpose, code] of cases) {
      const res = await request("POST", ADMIN_PATH, admin.cookie, { professionalId: prof.id, customerId: customer.id, purpose });
      assert.deepEqual((await json(res, 400)).fields, { purpose: code }, JSON.stringify(purpose).slice(0, 40));
    }
    // 300 characters after trimming is the limit.
    const { assignment } = await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        purpose: ` ${"ä".repeat(300)} `,
      }),
      201,
    );
    assert.equal(assignment.purpose, "ä".repeat(300));
  });

  test("rejects an invalid or past expiry", async () => {
    const customer = await createUser("USER");
    const cases: [unknown, string][] = [
      ["huomenna", "invalid"],
      ["", "invalid"],
      ["2030-12-01", "invalid"], // date only
      ["2030-12-01T12:00", "invalid"], // no offset: ambiguous time zone
      ["2030-12-01 12:00:00Z", "invalid"],
      ["2030-02-30T12:00:00Z", "invalid"],
      ["2030-12-01T24:30:00Z", "invalid"],
      ["2030-12-01T12:00:00+25:00", "invalid"],
      [Date.now() + 3600_000, "invalid"],
      [true, "invalid"],
      [withOffset(inHours(-1)), "in_past"],
      [new Date(Date.now() - 1000).toISOString(), "in_past"],
    ];
    for (const [expiresAt, code] of cases) {
      const res = await request("POST", ADMIN_PATH, admin.cookie, { professionalId: prof.id, customerId: customer.id, expiresAt });
      assert.deepEqual((await json(res, 400)).fields, { expiresAt: code }, JSON.stringify(expiresAt));
    }
    const [row] = await pool.query("SELECT COUNT(*) AS n FROM professional_customer_access WHERE customer_user_id = ?", [
      customer.id,
    ]);
    assert.equal(Number(row.n), 0);
  });

  test("role, duplicate and self-assignment rules still apply with metadata", async () => {
    const customer = await createUser("USER");
    const extra = { purpose: "Hoitojakso", expiresAt: withOffset(inHours(24)) };
    const roleCases: [number, number, Record<string, string>][] = [
      [user.id, customer.id, { professionalId: "invalid_role" }],
      [admin.id, customer.id, { professionalId: "invalid_role" }],
      [prof.id, otherProf.id, { customerId: "invalid_role" }],
      [prof.id, admin.id, { customerId: "invalid_role" }],
      // Self-assignment: the same account cannot be both, so one side always has the wrong role.
      [prof.id, prof.id, { customerId: "invalid_role" }],
    ];
    for (const [professionalId, customerId, fields] of roleCases) {
      const res = await request("POST", ADMIN_PATH, admin.cookie, { professionalId, customerId, ...extra });
      assert.deepEqual((await json(res, 400)).fields, fields, `${professionalId} -> ${customerId}`);
    }
    await json(await request("POST", ADMIN_PATH, admin.cookie, { professionalId: prof.id, customerId: customer.id, ...extra }), 201);
    const duplicate = await request("POST", ADMIN_PATH, admin.cookie, {
      professionalId: prof.id,
      customerId: customer.id,
      purpose: "Toinen syy",
    });
    assert.equal(duplicate.status, 409);
    // The database still refuses a self-assignment directly, with the new columns present.
    await assert.rejects(
      pool.query(
        "INSERT INTO professional_customer_access (professional_user_id, customer_user_id, created_by_user_id) VALUES (?, ?, ?)",
        [prof.id, prof.id, admin.id],
      ),
    );
  });
});

describe("authorization with expiry", () => {
  test("an assignment without expiry grants access", async () => {
    const customer = await createUser("USER", "Toivo");
    await json(await request("POST", ADMIN_PATH, admin.cookie, { professionalId: prof.id, customerId: customer.id }), 201);
    for (const path of customerPaths(customer.id)) {
      assert.equal((await request("GET", path, prof.cookie)).status, 200, path);
    }
    assert.ok((await assignedIds(prof)).includes(customer.id));
  });

  test("an active assignment with a future expiry grants access", async () => {
    const customer = await createUser("USER", "Venla");
    await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        expiresAt: withOffset(inHours(1)),
      }),
      201,
    );
    for (const path of customerPaths(customer.id)) {
      assert.equal((await request("GET", path, prof.cookie)).status, 200, path);
    }
    assert.ok((await assignedIds(prof)).includes(customer.id));
  });

  test("an expired assignment denies every customer route and drops out of the list", async () => {
    const customer = await createUser("USER", "Eino");
    await pool.query("INSERT INTO symptom_descriptions (user_id, description) VALUES (?, 'Eino: kuvaus')", [customer.id]);
    const { assignment } = await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        expiresAt: withOffset(inHours(1)),
      }),
      201,
    );
    assert.equal((await request("GET", customerPaths(customer.id)[0], prof.cookie)).status, 200);

    // Time passes: the expiry is now in the past (database time).
    await pool.query("UPDATE professional_customer_access SET expires_at = NOW() - INTERVAL 1 SECOND WHERE id = ?", [
      assignment.id,
    ]);
    for (const path of customerPaths(customer.id)) {
      const res = await request("GET", path, prof.cookie);
      assert.equal(res.status, 404, path);
      // Same answer as an unassigned customer: nothing about the customer is revealed.
      assert.deepEqual(await res.json(), { error: "Not found" });
    }
    assert.ok(!(await assignedIds(prof)).includes(customer.id));

    // The boundary is exclusive: an expiry equal to NOW() no longer grants access.
    await pool.query("UPDATE professional_customer_access SET expires_at = NOW() WHERE id = ?", [assignment.id]);
    assert.equal((await request("GET", customerPaths(customer.id)[0], prof.cookie)).status, 404);
  });

  test("an expired assignment does not leak a submission under the customer's path", async () => {
    const customer = await createUser("USER");
    const template = await pool.query("INSERT INTO form_templates (name, status) VALUES (?, 'PUBLISHED')", [
      `Vanhenemistesti ${randomUUID()}`,
    ]);
    const templateId = Number(template.insertId);
    try {
      const submission = await pool.query(
        `INSERT INTO form_submissions (user_id, form_template_id, status, reference_code, submitted_at)
         VALUES (?, ?, 'SUBMITTED', ?, CURRENT_TIMESTAMP)`,
        [customer.id, templateId, `LA-E${randomUUID().slice(0, 8).toUpperCase()}`],
      );
      const { assignment } = await json(
        await request("POST", ADMIN_PATH, admin.cookie, {
          professionalId: prof.id,
          customerId: customer.id,
          expiresAt: withOffset(inHours(1)),
        }),
        201,
      );
      const path = `/api/professional/customers/${customer.id}/submissions/${Number(submission.insertId)}`;
      assert.equal((await request("GET", path, prof.cookie)).status, 200);
      await pool.query("UPDATE professional_customer_access SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?", [
        assignment.id,
      ]);
      assert.equal((await request("GET", path, prof.cookie)).status, 404);
    } finally {
      await pool.query("DELETE FROM form_submissions WHERE form_template_id = ?", [templateId]);
      await pool.query("DELETE FROM form_templates WHERE id = ?", [templateId]);
    }
  });

  test("a professional cannot reach another professional's active customer", async () => {
    const customer = await createUser("USER");
    await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        expiresAt: withOffset(inHours(5)),
      }),
      201,
    );
    for (const path of customerPaths(customer.id)) {
      assert.equal((await request("GET", path, otherProf.cookie)).status, 404, path);
    }
    assert.ok(!(await assignedIds(otherProf)).includes(customer.id));
  });

  test("removing an assignment with metadata ends access", async () => {
    const customer = await createUser("USER");
    const { assignment } = await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        purpose: "Lyhyt jakso",
        expiresAt: withOffset(inHours(5)),
      }),
      201,
    );
    assert.equal((await request("GET", customerPaths(customer.id)[0], prof.cookie)).status, 200);
    assert.equal((await request("DELETE", `${ADMIN_PATH}/${assignment.id}`, admin.cookie)).status, 204);
    for (const path of customerPaths(customer.id)) {
      assert.equal((await request("GET", path, prof.cookie)).status, 404, path);
    }
  });

  test("a role change invalidates an active, unexpired assignment", async () => {
    const customer = await createUser("USER");
    await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        expiresAt: withOffset(inHours(5)),
      }),
      201,
    );
    await pool.query("UPDATE users SET role = 'ADMIN' WHERE id = ?", [customer.id]);
    try {
      assert.equal((await request("GET", customerPaths(customer.id)[0], prof.cookie)).status, 404);
    } finally {
      await pool.query("UPDATE users SET role = 'USER' WHERE id = ?", [customer.id]);
    }
    await pool.query("UPDATE users SET role = 'USER' WHERE id = ?", [prof.id]);
    try {
      assert.equal((await request("GET", customerPaths(customer.id)[0], prof.cookie)).status, 403);
    } finally {
      await pool.query("UPDATE users SET role = 'PROFESSIONAL' WHERE id = ?", [prof.id]);
    }
    assert.equal((await request("GET", customerPaths(customer.id)[0], prof.cookie)).status, 200);
  });

  test("ADMIN still cannot use professional customer routes, even as the creator", async () => {
    const customer = await createUser("USER");
    await json(await request("POST", ADMIN_PATH, admin.cookie, { professionalId: prof.id, customerId: customer.id }), 201);
    assert.equal((await request("GET", "/api/professional/customers", admin.cookie)).status, 403);
    for (const path of customerPaths(customer.id)) {
      assert.equal((await request("GET", path, admin.cookie)).status, 403, path);
      assert.equal((await request("GET", path, user.cookie)).status, 403, path);
      assert.equal((await request("GET", path)).status, 401, path);
    }
  });
});

describe("listing", () => {
  test("admin sees purpose, creator, expiry and status", async () => {
    const customer = await createUser("USER", "Lyydia");
    const expires = inHours(72);
    const { assignment } = await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        purpose: "Kuntoutuksen seuranta",
        expiresAt: withOffset(expires),
      }),
      201,
    );
    const item = await listed(assignment.id);
    assert.equal(item.purpose, "Kuntoutuksen seuranta");
    assert.deepEqual(item.createdBy, { id: admin.id, email: admin.email });
    assert.equal(new Date(item.expiresAt).toISOString(), expires.toISOString());
    assert.equal(item.status, "ACTIVE");
    assert.ok(item.createdAt);
    // Existing fields are unchanged.
    assert.deepEqual(item.professional, { id: prof.id, email: prof.email });
    assert.deepEqual(item.customer, { id: customer.id, email: customer.email, firstName: "Lyydia", lastName: "Testinen" });
    assert.deepEqual(Object.keys(item).sort(), [
      "createdAt",
      "createdBy",
      "customer",
      "expiresAt",
      "id",
      "professional",
      "purpose",
      "status",
    ]);
  });

  test("an expired assignment is listed as EXPIRED, not hidden", async () => {
    const customer = await createUser("USER");
    const { assignment } = await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        expiresAt: withOffset(inHours(1)),
      }),
      201,
    );
    await pool.query("UPDATE professional_customer_access SET expires_at = NOW() - INTERVAL 1 DAY WHERE id = ?", [
      assignment.id,
    ]);
    const item = await listed(assignment.id);
    assert.equal(item.status, "EXPIRED");
    assert.ok(new Date(item.expiresAt).getTime() < Date.now());
  });

  test("an assignment without a recorded creator stays active and shows no creator", async () => {
    // Like assignments created before migration 008: no creator, no purpose, no expiry.
    const customer = await createUser("USER");
    const result = await pool.query(
      "INSERT INTO professional_customer_access (professional_user_id, customer_user_id) VALUES (?, ?)",
      [prof.id, customer.id],
    );
    const item = await listed(Number(result.insertId));
    assert.equal(item.createdBy, null);
    assert.equal(item.purpose, null);
    assert.equal(item.expiresAt, null);
    assert.equal(item.status, "ACTIVE");
    assert.equal((await request("GET", customerPaths(customer.id)[0], prof.cookie)).status, 200);
  });

  test("deleting the creating admin keeps the assignment and clears the creator", async () => {
    const tempAdmin = await createUser("ADMIN");
    const customer = await createUser("USER");
    const { assignment } = await json(
      await request("POST", ADMIN_PATH, tempAdmin.cookie, { professionalId: prof.id, customerId: customer.id }),
      201,
    );
    assert.equal((await stored(assignment.id)).created_by_user_id, tempAdmin.id);
    await pool.query("DELETE FROM users WHERE id = ?", [tempAdmin.id]);
    const item = await listed(assignment.id);
    assert.equal(item.createdBy, null);
    assert.equal((await request("GET", customerPaths(customer.id)[0], prof.cookie)).status, 200);
  });

  test("the professional gets purpose and expiry, but no admin-only metadata", async () => {
    const customer = await createUser("USER", "Selma");
    const expires = inHours(10);
    await json(
      await request("POST", ADMIN_PATH, admin.cookie, {
        professionalId: prof.id,
        customerId: customer.id,
        purpose: "Hoitojakson esitiedot",
        expiresAt: withOffset(expires),
      }),
      201,
    );
    const res = await request("GET", `/api/professional/customers/${customer.id}`, prof.cookie);
    const body = await json(res);
    assert.deepEqual(Object.keys(body).sort(), ["access", "customer"]);
    assert.deepEqual(Object.keys(body.access).sort(), ["expiresAt", "purpose"]);
    assert.equal(body.access.purpose, "Hoitojakson esitiedot");
    assert.equal(new Date(body.access.expiresAt).toISOString(), expires.toISOString());
    assert.deepEqual(Object.keys(body.customer).sort(), ["dateOfBirth", "firstName", "id", "lastName", "phone"]);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(admin.email), "admin email must not be exposed");
    assert.ok(!/created/i.test(raw), "no creator or creation metadata");

    // The list and the timeline are unchanged and carry no assignment metadata.
    const { customers } = await json(await request("GET", "/api/professional/customers", prof.cookie));
    for (const item of customers) assert.deepEqual(Object.keys(item).sort(), ["dateOfBirth", "firstName", "id", "lastName"]);
    const timeline = await request("GET", `/api/professional/customers/${customer.id}/timeline`, prof.cookie);
    assert.ok(!(await timeline.text()).includes("Hoitojakson esitiedot"));
  });

  test("unauthorized callers get the existing 401/403", async () => {
    assert.equal((await request("GET", ADMIN_PATH)).status, 401);
    for (const account of [user, prof]) {
      assert.equal((await request("GET", ADMIN_PATH, account.cookie)).status, 403);
    }
  });
});
