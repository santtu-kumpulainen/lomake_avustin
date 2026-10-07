// Integration tests for the customer profile (Issue #20) against the configured MariaDB.
// Users created here are deleted afterwards; profiles go with them (ON DELETE CASCADE).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { validateProfile } from "../src/profile/validation.js";

const PASSWORD = "testisalasana-123";
const createdEmails: string[] = [];

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

type TestUser = { cookie: string; id: number; email: string };
let user: TestUser;
let otherUser: TestUser;

const validProfile = {
  firstName: "Testi",
  lastName: "Henkilö",
  dateOfBirth: "1985-04-12",
  phone: "+358 40 123 4567",
};

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
  const email = `profile-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  const { user: created } = await res.json();
  if (role !== "USER") await pool.query("UPDATE users SET role = ? WHERE email = ?", [role, email]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: created.id, email };
}

async function storedProfile(userId: number) {
  const rows = await pool.query(
    "SELECT first_name, last_name, DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth, phone FROM user_profiles WHERE user_id = ?",
    [userId],
  );
  return rows[0];
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  user = await createUser();
  otherUser = await createUser();
});

after(async () => {
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("reading the profile", () => {
  test("unauthenticated requests get 401", async () => {
    assert.equal((await request("GET", "/api/profile")).status, 401);
    assert.equal((await request("PUT", "/api/profile", validProfile)).status, 401);
  });

  test("a new user gets an empty profile with their email", async () => {
    const fresh = await createUser();
    const res = await request("GET", "/api/profile", undefined, fresh.cookie);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).profile, {
      email: fresh.email,
      firstName: "",
      lastName: "",
      dateOfBirth: null,
      phone: null,
      updatedAt: null,
    });
  });

  test("only allowlisted fields are returned", async () => {
    await request("PUT", "/api/profile", validProfile, user.cookie);
    const res = await request("GET", "/api/profile", undefined, user.cookie);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ["profile"]);
    assert.deepEqual(Object.keys(body.profile).sort(), [
      "dateOfBirth",
      "email",
      "firstName",
      "lastName",
      "phone",
      "updatedAt",
    ]);
    const text = JSON.stringify(body);
    for (const secret of ["password", "hash", "token", "session", "role", "userId", "user_id", "argon2"]) {
      assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `response contains ${secret}`);
    }
  });

  test("ADMIN and PROFESSIONAL get 403 and no customer data", async () => {
    for (const role of ["ADMIN", "PROFESSIONAL"] as const) {
      const staff = await createUser(role);
      const get = await request("GET", "/api/profile", undefined, staff.cookie);
      assert.equal(get.status, 403);
      assert.equal((await get.text()).includes(user.email), false);
      assert.equal((await request("PUT", "/api/profile", validProfile, staff.cookie)).status, 403);
      assert.equal(await storedProfile(staff.id), undefined);
    }
  });
});

describe("updating the profile", () => {
  test("a user creates and then replaces their own profile", async () => {
    const fresh = await createUser();
    let res = await request("PUT", "/api/profile", validProfile, fresh.cookie);
    assert.equal(res.status, 200);
    const { profile } = await res.json();
    assert.equal(profile.email, fresh.email);
    assert.equal(profile.firstName, "Testi");
    assert.equal(profile.dateOfBirth, "1985-04-12");
    assert.ok(profile.updatedAt);

    // PUT replaces: cleared optional fields become null; values are trimmed.
    res = await request(
      "PUT",
      "/api/profile",
      { firstName: "  Uusi ", lastName: "Nimi", dateOfBirth: "", phone: null },
      fresh.cookie,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await storedProfile(fresh.id), {
      first_name: "Uusi",
      last_name: "Nimi",
      date_of_birth: null,
      phone: null,
    });
    const rows = await pool.query("SELECT COUNT(*) AS n FROM user_profiles WHERE user_id = ?", [fresh.id]);
    assert.equal(Number(rows[0].n), 1);
  });

  test("invalid data is rejected with field errors and nothing is saved", async () => {
    const fresh = await createUser();
    await request("PUT", "/api/profile", validProfile, fresh.cookie);
    const res = await request(
      "PUT",
      "/api/profile",
      { firstName: "", lastName: "x".repeat(101), dateOfBirth: "1990-02-30", phone: "abc" },
      fresh.cookie,
    );
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, {
      firstName: "required",
      lastName: "too_long",
      dateOfBirth: "invalid_date",
      phone: "invalid",
    });
    assert.equal((await storedProfile(fresh.id)).first_name, "Testi");
  });

  test("userId in the request cannot target another user", async () => {
    const before = await storedProfile(otherUser.id);
    for (const key of ["userId", "user_id", "id"]) {
      const res = await request("PUT", "/api/profile", { ...validProfile, [key]: otherUser.id }, user.cookie);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).fields[key], "not_allowed");
    }
    assert.deepEqual(await storedProfile(otherUser.id), before);

    // Query parameters and path ids are not read either.
    const viaQuery = await request("GET", `/api/profile?userId=${otherUser.id}`, undefined, user.cookie);
    assert.equal((await viaQuery.json()).profile.email, user.email);
    assert.equal((await request("GET", `/api/profile/${otherUser.id}`, undefined, user.cookie)).status, 404);
  });

  test("another user's saved profile is never returned or changed", async () => {
    await request("PUT", "/api/profile", { ...validProfile, firstName: "Toinen" }, otherUser.cookie);
    await request("PUT", "/api/profile", { ...validProfile, firstName: "Oma" }, user.cookie);
    const mine = (await (await request("GET", "/api/profile", undefined, user.cookie)).json()).profile;
    assert.equal(mine.firstName, "Oma");
    assert.equal(mine.email, user.email);
    assert.equal((await storedProfile(otherUser.id)).first_name, "Toinen");
  });

  test("email and role cannot be changed through the profile", async () => {
    const res = await request(
      "PUT",
      "/api/profile",
      { ...validProfile, email: "hijack@example.test", role: "ADMIN" },
      user.cookie,
    );
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { email: "not_allowed", role: "not_allowed" });
    const [row] = await pool.query("SELECT email, role FROM users WHERE id = ?", [user.id]);
    assert.deepEqual({ ...row }, { email: user.email, role: "USER" });
  });
});

describe("profile validation rules", () => {
  const today = "2026-10-07";
  const check = (input: Record<string, unknown>) => validateProfile({ ...validProfile, ...input }, today);

  test("date of birth must be a real date between 1900 and today", () => {
    assert.equal(check({ dateOfBirth: today }).ok, true);
    assert.deepEqual(check({ dateOfBirth: "2026-10-08" }), { ok: false, errors: { dateOfBirth: "out_of_range" } });
    assert.deepEqual(check({ dateOfBirth: "1899-12-31" }), { ok: false, errors: { dateOfBirth: "out_of_range" } });
    assert.deepEqual(check({ dateOfBirth: "12.4.1985" }), { ok: false, errors: { dateOfBirth: "invalid_date" } });
  });

  test("phone accepts common formats and rejects others", () => {
    for (const phone of ["0401234567", "+358 40 123 4567", "(09) 123-456"]) assert.equal(check({ phone }).ok, true);
    for (const phone of ["1234", "+358-40-abc", "++358401234567", "1".repeat(16)]) {
      assert.deepEqual(check({ phone }), { ok: false, errors: { phone: "invalid" } });
    }
    assert.deepEqual(check({ phone: "1 ".repeat(16) }), { ok: false, errors: { phone: "too_long" } });
  });

  test("names reject non-strings and control characters", () => {
    assert.deepEqual(check({ firstName: 5 }), { ok: false, errors: { firstName: "invalid" } });
    assert.deepEqual(check({ lastName: "A\u0000B" }), { ok: false, errors: { lastName: "invalid" } });
    assert.deepEqual(check({ dateOfBirth: 19850412 }), { ok: false, errors: { dateOfBirth: "invalid" } });
  });
});
