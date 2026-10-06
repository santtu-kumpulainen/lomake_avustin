// Integration tests against the configured MariaDB (synthetic data only).
// Users created here use the @example.test domain and are deleted afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import argon2 from "argon2";
import express from "express";
import { app } from "../src/app.js";
import { requireRole } from "../src/auth/middleware.js";
import { pool } from "../src/db.js";

const PASSWORD = "testisalasana-123";
const createdEmails: string[] = [];

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

// Mounts the role middleware on a throwaway route to test it outside real features.
const testApp = express();
testApp.get("/admin-only", requireRole("ADMIN"), (req, res) => {
  res.json({ ok: true, role: req.user?.role });
});
testApp.use(app);

function newEmail(): string {
  const email = `auth-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  return email;
}

async function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(setCookie, "expected a session cookie");
  return setCookie.split(";")[0];
}

async function register(email: string) {
  const res = await post("/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  return { res, cookie: sessionCookie(res) };
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = testApp.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("health", () => {
  test("GET /api/health still works", async () => {
    const res = await get("/api/health");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "ok");
  });
});

describe("registration", () => {
  test("registers a USER, sets an HTTP-only cookie and hides the hash", async () => {
    const email = newEmail();
    const { res } = await register(email);
    const body = await res.json();

    assert.equal(body.user.email, email);
    assert.equal(body.user.role, "USER");
    assert.equal(body.user.password_hash, undefined);
    assert.equal(JSON.stringify(body).includes(PASSWORD), false);

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="))!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  test("stores the password only as an argon2id hash", async () => {
    const email = newEmail();
    await register(email);
    const [row] = await pool.query("SELECT password_hash FROM users WHERE email = ?", [email]);

    assert.notEqual(row.password_hash, PASSWORD);
    assert.match(row.password_hash, /^\$argon2id\$/);
    assert.equal(await argon2.verify(row.password_hash, PASSWORD), true);
  });

  test("rejects a duplicate email, also with different case", async () => {
    const email = newEmail();
    await register(email);
    const res = await post("/api/auth/register", { email: email.toUpperCase(), password: PASSWORD });

    assert.equal(res.status, 409);
    assert.deepEqual((await res.json()).fields, { email: "taken" });
  });

  test("validates required fields, email format and password length", async () => {
    let res = await post("/api/auth/register", {});
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { email: "required", password: "required" });

    res = await post("/api/auth/register", { email: "not-an-email", password: "short" });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { email: "invalid", password: "too_short" });
  });

  test("ignores a submitted role, so registration cannot grant ADMIN", async () => {
    const email = newEmail();
    const res = await post("/api/auth/register", { email, password: PASSWORD, role: "ADMIN" });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).user.role, "USER");

    const [row] = await pool.query("SELECT role FROM users WHERE email = ?", [email]);
    assert.equal(row.role, "USER");

    const admin = await get("/admin-only", sessionCookie(res));
    assert.equal(admin.status, 403);
  });
});

describe("login", () => {
  test("logs in with valid credentials", async () => {
    const email = newEmail();
    await register(email);
    const res = await post("/api/auth/login", { email, password: PASSWORD });

    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.email, email);
    sessionCookie(res);
  });

  test("returns the same generic error for a wrong password and an unknown email", async () => {
    const email = newEmail();
    await register(email);

    const wrongPassword = await post("/api/auth/login", { email, password: "vaara-salasana-1" });
    const unknownEmail = await post("/api/auth/login", {
      email: `nobody-${randomUUID()}@example.test`,
      password: PASSWORD,
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.deepEqual(await wrongPassword.json(), await unknownEmail.json());
    assert.equal(wrongPassword.headers.getSetCookie().length, 0);
  });
});

describe("current user and logout", () => {
  test("GET /api/auth/me requires authentication", async () => {
    assert.equal((await get("/api/auth/me")).status, 401);
    const forged = `la_session=${"a".repeat(64)}`;
    assert.equal((await get("/api/auth/me", forged)).status, 401);
  });

  test("GET /api/auth/me returns the authenticated user without the hash", async () => {
    const email = newEmail();
    const { cookie } = await register(email);
    const res = await get("/api/auth/me", cookie);

    assert.equal(res.status, 200);
    const { user } = await res.json();
    assert.deepEqual(Object.keys(user).sort(), ["email", "id", "role"]);
    assert.equal(user.email, email);
    assert.equal(user.role, "USER");
  });

  test("logout invalidates the session on the server", async () => {
    const email = newEmail();
    const { cookie } = await register(email);
    assert.equal((await get("/api/auth/me", cookie)).status, 200);

    const res = await post("/api/auth/logout", {}, cookie);
    assert.equal(res.status, 204);
    assert.match(res.headers.getSetCookie()[0], /la_session=;/);

    // The old token is rejected even if the client still sends it.
    assert.equal((await get("/api/auth/me", cookie)).status, 401);
  });
});

describe("requireRole", () => {
  test("allows a user whose role was changed server-side", async () => {
    const email = newEmail();
    const { cookie } = await register(email);
    assert.equal((await get("/admin-only", cookie)).status, 403);

    await pool.query("UPDATE users SET role = 'ADMIN' WHERE email = ?", [email]);
    const res = await get("/admin-only", cookie);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).role, "ADMIN");
  });

  test("returns 401 without a session", async () => {
    assert.equal((await get("/admin-only")).status, 401);
  });
});
