// Customer symptom/reason descriptions (Issue #26). Integration tests against the configured
// MariaDB (synthetic data only). Users created here, and their descriptions, are deleted afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

const PASSWORD = "testisalasana-123";
const PATH = "/api/symptom-descriptions";
const createdEmails: string[] = [];

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

type Account = { cookie: string; id: number };
const accounts = {} as Record<"USER" | "OTHER" | "ADMIN" | "PROFESSIONAL", Account>;

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

async function createUser(role: "USER" | "ADMIN" | "PROFESSIONAL"): Promise<Account> {
  const email = `symptoms-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  const { user } = await res.json();
  await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, user.id]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: user.id };
}

async function rowsOf(userId: number): Promise<{ id: number; description: string }[]> {
  return pool.query("SELECT id, description FROM symptom_descriptions WHERE user_id = ? ORDER BY id", [userId]);
}

async function create(account: Account, description: unknown) {
  return request("POST", PATH, { description }, account.cookie);
}

async function list(account: Account) {
  const res = await request("GET", PATH, undefined, account.cookie);
  assert.equal(res.status, 200);
  return (await res.json()).symptomDescriptions as { id: number; description: string; createdAt: string }[];
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  accounts.USER = await createUser("USER");
  accounts.OTHER = await createUser("USER");
  accounts.ADMIN = await createUser("ADMIN");
  accounts.PROFESSIONAL = await createUser("PROFESSIONAL");
});

after(async () => {
  // ON DELETE CASCADE removes the descriptions with the users.
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("authentication and roles", () => {
  test("GET and POST require a session", async () => {
    assert.equal((await request("GET", PATH)).status, 401);
    const marker = `Kirjautumaton ${randomUUID()}`;
    assert.equal((await request("POST", PATH, { description: marker })).status, 401);
    const [row] = await pool.query("SELECT COUNT(*) AS n FROM symptom_descriptions WHERE description = ?", [marker]);
    assert.equal(Number(row.n), 0);
  });

  test("ADMIN and PROFESSIONAL get 403 and cannot read customers' descriptions", async () => {
    await create(accounts.USER, "Synteettinen kuvaus asiakkaalta.");
    for (const role of ["ADMIN", "PROFESSIONAL"] as const) {
      const account = accounts[role];
      assert.equal((await request("GET", PATH, undefined, account.cookie)).status, 403, role);
      assert.equal(
        (await request("GET", `${PATH}?userId=${accounts.USER.id}`, undefined, account.cookie)).status,
        403,
        role,
      );
      assert.equal((await create(account, "Henkilöstön kuvaus.")).status, 403, role);
      assert.equal((await rowsOf(account.id)).length, 0, role);
    }
  });
});

describe("creating and listing", () => {
  test("USER creates a description; text is trimmed and only allowed fields are returned", async () => {
    const res = await create(accounts.USER, "  Haluan kertoa viime päivinä alkaneesta oireesta, joka vaikuttaa arkeeni.  \n");
    assert.equal(res.status, 201);
    const { symptomDescription } = await res.json();
    assert.deepEqual(Object.keys(symptomDescription).sort(), ["createdAt", "description", "id"]);
    assert.equal(
      symptomDescription.description,
      "Haluan kertoa viime päivinä alkaneesta oireesta, joka vaikuttaa arkeeni.",
    );
    assert.ok(!Number.isNaN(Date.parse(symptomDescription.createdAt)));

    const [row] = await pool.query("SELECT user_id, description FROM symptom_descriptions WHERE id = ?", [
      symptomDescription.id,
    ]);
    assert.equal(row.user_id, accounts.USER.id, "owner comes from the session");
    assert.equal(row.description, symptomDescription.description);
  });

  test("line breaks are kept", async () => {
    const res = await create(accounts.USER, "Ensimmäinen rivi.\nToinen rivi.\r\n\tSisennetty.");
    assert.equal(res.status, 201);
    assert.equal((await res.json()).symptomDescription.description, "Ensimmäinen rivi.\nToinen rivi.\r\n\tSisennetty.");
  });

  test("USER gets only their own descriptions, newest first", async () => {
    const user = await createUser("USER");
    const texts = ["Ensimmäinen kuvaus.", "Toinen kuvaus.", "Kolmas kuvaus."];
    for (const text of texts) assert.equal((await create(user, text)).status, 201);
    // An older row inserted last: ordering must follow created_at, not insertion order.
    await pool.query("INSERT INTO symptom_descriptions (user_id, description, created_at) VALUES (?, ?, ?)", [
      user.id,
      "Vanha kuvaus.",
      "2026-01-15 10:00:00",
    ]);
    await create(accounts.OTHER, "Toisen käyttäjän kuvaus.");

    const descriptions = await list(user);
    assert.deepEqual(
      descriptions.map((d) => d.description),
      ["Kolmas kuvaus.", "Toinen kuvaus.", "Ensimmäinen kuvaus.", "Vanha kuvaus."],
    );
    for (const item of descriptions) {
      assert.deepEqual(Object.keys(item).sort(), ["createdAt", "description", "id"]);
    }
  });

  test("a new user has an empty history", async () => {
    const user = await createUser("USER");
    assert.deepEqual(await list(user), []);
  });
});

describe("validation", () => {
  async function expectError(body: unknown, field: string, code: string) {
    const before = (await rowsOf(accounts.USER.id)).length;
    const res = await request("POST", PATH, body, accounts.USER.cookie);
    assert.equal(res.status, 400, JSON.stringify(body)?.slice(0, 80));
    const json = await res.json();
    assert.equal(json.fields[field], code, JSON.stringify(body)?.slice(0, 80));
    assert.equal((await rowsOf(accounts.USER.id)).length, before, "nothing is saved");
    return json;
  }

  test("empty, whitespace-only, missing and null descriptions are required", async () => {
    await expectError({ description: "" }, "description", "required");
    await expectError({ description: "   \n\t  " }, "description", "required");
    await expectError({}, "description", "required");
    await expectError({ description: null }, "description", "required");
  });

  test("length limits are 5 to 2000 characters after trimming", async () => {
    await expectError({ description: "Kipu" }, "description", "too_short");
    await expectError({ description: "  abcd  " }, "description", "too_short");
    await expectError({ description: "x".repeat(2001) }, "description", "too_long");
    assert.equal((await create(accounts.USER, "Väsyy")).status, 201);
    assert.equal((await create(accounts.USER, `  ${"y".repeat(2000)}  `)).status, 201);
  });

  test("non-string values and control characters are invalid", async () => {
    await expectError({ description: 12345 }, "description", "invalid");
    await expectError({ description: ["Kuvaus tässä"] }, "description", "invalid");
    await expectError({ description: { text: "Kuvaus tässä" } }, "description", "invalid");
    await expectError({ description: true }, "description", "invalid");
    await expectError({ description: "Kuvaus\u0000 nollamerkillä" }, "description", "invalid");
    await expectError({ description: "Kuvaus\u001b ohjausmerkillä" }, "description", "invalid");
  });

  test("a body that is not an object is rejected", async () => {
    await expectError(["Kuvaus tässä"], "description", "required");
    const res = await fetch(`${baseUrl}${PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: accounts.USER.cookie },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });

  test("error responses do not echo the description", async () => {
    const marker = `x${randomUUID()}`.repeat(60);
    const res = await request("POST", PATH, { description: marker }, accounts.USER.cookie);
    assert.equal(res.status, 400);
    assert.ok(!(await res.text()).includes(marker.slice(0, 30)));
  });
});

describe("ownership", () => {
  test("userId, user_id and other unexpected keys are rejected and nothing is saved", async () => {
    const before = (await rowsOf(accounts.OTHER.id)).length;
    const ownBefore = (await rowsOf(accounts.USER.id)).length;
    for (const extra of [
      { userId: accounts.OTHER.id },
      { user_id: accounts.OTHER.id },
      { id: 1 },
      { createdAt: "2020-01-01T00:00:00Z" },
    ]) {
      const res = await request("POST", PATH, { description: "Yritän tallentaa toiselle.", ...extra }, accounts.USER.cookie);
      assert.equal(res.status, 400);
      const { fields } = await res.json();
      assert.equal(fields[Object.keys(extra)[0]], "not_allowed");
    }
    assert.equal((await rowsOf(accounts.OTHER.id)).length, before);
    assert.equal((await rowsOf(accounts.USER.id)).length, ownBefore);
  });

  test("query parameters cannot select or set another owner", async () => {
    for (const query of [`userId=${accounts.OTHER.id}`, `user_id=${accounts.OTHER.id}`, "email=x"]) {
      const get = await request("GET", `${PATH}?${query}`, undefined, accounts.USER.cookie);
      assert.equal(get.status, 400, query);
      const post = await request("POST", `${PATH}?${query}`, { description: "Kuvaus kyselyllä." }, accounts.USER.cookie);
      assert.equal(post.status, 400, query);
    }
    assert.equal((await rowsOf(accounts.OTHER.id)).some((r) => r.description === "Kuvaus kyselyllä."), false);
  });

  test("another user's descriptions are never returned", async () => {
    const marker = `Vain omistajalle ${randomUUID()}`;
    assert.equal((await create(accounts.OTHER, marker)).status, 201);
    const own = await list(accounts.USER);
    assert.equal(own.some((d) => d.description === marker), false);
    const ownIds = new Set((await rowsOf(accounts.USER.id)).map((r) => r.id));
    assert.ok(own.every((d) => ownIds.has(d.id)));
    // There are no per-id routes to probe.
    const [row] = await rowsOf(accounts.OTHER.id);
    assert.equal((await request("GET", `${PATH}/${row.id}`, undefined, accounts.USER.cookie)).status, 404);
  });
});

describe("privacy", () => {
  test("descriptions do not appear in unrelated APIs", async () => {
    const marker = `Erillinen kuvaus ${randomUUID()}`;
    assert.equal((await create(accounts.USER, marker)).status, 201);
    for (const path of [
      "/api/auth/me",
      "/api/profile",
      "/api/forms",
      "/api/submissions",
      "/api/submissions/drafts",
    ]) {
      const res = await request("GET", path, undefined, accounts.USER.cookie);
      assert.equal(res.status, 200, path);
      assert.ok(!(await res.text()).includes(marker), path);
    }
  });

  test("database error messages do not contain the description", async () => {
    const marker = `Ei lokiin ${randomUUID()}`;
    // Foreign key failure: a user id that does not exist.
    await assert.rejects(
      pool.query("INSERT INTO symptom_descriptions (user_id, description) VALUES (?, ?)", [4294967295, marker]),
      (err: Error) => {
        assert.ok(!err.message.includes(marker), "query parameters are not in the error message");
        return true;
      },
    );
  });

  test("deleting a user deletes their descriptions", async () => {
    const user = await createUser("USER");
    await create(user, "Poistuu käyttäjän mukana.");
    assert.equal((await rowsOf(user.id)).length, 1);
    await pool.query("DELETE FROM users WHERE id = ?", [user.id]);
    assert.equal((await rowsOf(user.id)).length, 0);
  });
});
