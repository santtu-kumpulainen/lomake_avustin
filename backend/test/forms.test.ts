// Integration tests against the configured MariaDB (synthetic data only).
// Users and templates created here are deleted afterwards.
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
const cookies: Record<"ADMIN" | "USER" | "PROFESSIONAL", string> = {
  ADMIN: "",
  USER: "",
  PROFESSIONAL: "",
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

async function createUser(role: "ADMIN" | "USER" | "PROFESSIONAL"): Promise<string> {
  const email = `forms-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  // Roles are only changed server-side, as with the set-role script.
  await pool.query("UPDATE users SET role = ? WHERE email = ?", [role, email]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return cookie.split(";")[0];
}

async function createTemplate(name = `Testilomake ${randomUUID()}`) {
  const res = await request("POST", "/api/forms", { name, description: "Synteettinen" }, cookies.ADMIN);
  assert.equal(res.status, 201);
  const { template } = await res.json();
  createdTemplateIds.push(template.id);
  return template;
}

async function addField(templateId: number, field: Record<string, unknown>) {
  return request("POST", `/api/forms/${templateId}/fields`, field, cookies.ADMIN);
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cookies.ADMIN = await createUser("ADMIN");
  cookies.USER = await createUser("USER");
  cookies.PROFESSIONAL = await createUser("PROFESSIONAL");
});

after(async () => {
  if (createdTemplateIds.length > 0) {
    await pool.query("DELETE FROM form_templates WHERE id IN (?)", [createdTemplateIds]);
  }
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("creating templates", () => {
  test("ADMIN can create a template as a draft", async () => {
    const template = await createTemplate("Esitietolomake");
    assert.equal(template.name, "Esitietolomake");
    assert.equal(template.description, "Synteettinen");
    assert.equal(template.status, "DRAFT");
    assert.deepEqual(template.fields, []);
  });

  test("USER and PROFESSIONAL get 403", async () => {
    for (const role of ["USER", "PROFESSIONAL"] as const) {
      const res = await request("POST", "/api/forms", { name: "Ei sallittu" }, cookies[role]);
      assert.equal(res.status, 403, role);
    }
  });

  test("unauthenticated requests get 401", async () => {
    assert.equal((await request("POST", "/api/forms", { name: "Ei sallittu" })).status, 401);
    assert.equal((await request("GET", "/api/forms")).status, 401);
  });

  test("rejects a missing or blank name", async () => {
    for (const body of [{}, { name: "   " }]) {
      const res = await request("POST", "/api/forms", body, cookies.ADMIN);
      assert.equal(res.status, 400);
      assert.deepEqual((await res.json()).fields, { name: "required" });
    }
  });

  test("ADMIN can update name and description", async () => {
    const template = await createTemplate();
    const res = await request(
      "PATCH",
      `/api/forms/${template.id}`,
      { name: "Uusi nimi", description: "" },
      cookies.ADMIN,
    );
    assert.equal(res.status, 200);
    const updated = (await res.json()).template;
    assert.equal(updated.name, "Uusi nimi");
    assert.equal(updated.description, null);
  });
});

describe("field validation", () => {
  test("rejects a missing label and an unsupported field type", async () => {
    const template = await createTemplate();
    const res = await addField(template.id, { fieldType: "CHECKBOX" });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { label: "required", fieldType: "invalid" });
  });

  test("SELECT requires non-empty, unique options", async () => {
    const template = await createTemplate();
    const cases: [unknown, string][] = [
      [undefined, "required"],
      [[], "required"],
      ["Kyllä", "invalid"],
      [["Kyllä", " "], "empty_option"],
      [["Kyllä", "Kyllä"], "duplicate"],
    ];
    for (const [options, code] of cases) {
      const res = await addField(template.id, { label: "Valinta", fieldType: "SELECT", options });
      assert.equal(res.status, 400);
      assert.deepEqual((await res.json()).fields, { options: code });
    }
  });

  test("non-SELECT fields cannot have options", async () => {
    const template = await createTemplate();
    const res = await addField(template.id, {
      label: "Ikä",
      fieldType: "NUMBER",
      options: ["1", "2"],
    });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { options: "not_allowed" });
  });

  test("required must be a boolean", async () => {
    const template = await createTemplate();
    const res = await addField(template.id, { label: "Nimi", fieldType: "TEXT", required: "yes" });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, { required: "invalid" });
  });
});

describe("managing fields", () => {
  test("ADMIN can add, update and delete fields", async () => {
    const template = await createTemplate();

    let res = await addField(template.id, { label: "Nimi", fieldType: "TEXT", required: true });
    assert.equal(res.status, 201);
    res = await addField(template.id, {
      label: "Tupakoitko?",
      fieldType: "SELECT",
      options: ["Kyllä", "Ei"],
    });
    assert.equal(res.status, 201);
    let fields = (await res.json()).template.fields;
    assert.deepEqual(
      fields.map((f: { label: string; position: number }) => [f.label, f.position]),
      [["Nimi", 1], ["Tupakoitko?", 2]],
    );
    assert.equal(fields[0].required, true);
    assert.equal(fields[0].options, null);
    assert.deepEqual(fields[1].options, ["Kyllä", "Ei"]);

    // Changing SELECT to another type drops its options.
    res = await request(
      "PATCH",
      `/api/forms/${template.id}/fields/${fields[1].id}`,
      { label: "Syntymäaika", fieldType: "DATE" },
      cookies.ADMIN,
    );
    assert.equal(res.status, 200);
    fields = (await res.json()).template.fields;
    assert.equal(fields[1].label, "Syntymäaika");
    assert.equal(fields[1].fieldType, "DATE");
    assert.equal(fields[1].options, null);
    assert.equal(fields[1].required, false);

    res = await request(
      "DELETE",
      `/api/forms/${template.id}/fields/${fields[0].id}`,
      undefined,
      cookies.ADMIN,
    );
    assert.equal(res.status, 200);
    fields = (await res.json()).template.fields;
    assert.deepEqual(fields.map((f: { label: string }) => f.label), ["Syntymäaika"]);
  });

  test("a field of another template is not found", async () => {
    const first = await createTemplate();
    const second = await createTemplate();
    const res = await addField(first.id, { label: "Nimi", fieldType: "TEXT" });
    const fieldId = (await res.json()).template.fields[0].id;

    const patch = await request(
      "PATCH",
      `/api/forms/${second.id}/fields/${fieldId}`,
      { label: "Muutettu" },
      cookies.ADMIN,
    );
    assert.equal(patch.status, 404);
  });

  test("ADMIN can reorder fields", async () => {
    const template = await createTemplate();
    for (const label of ["A", "B", "C"]) {
      await addField(template.id, { label, fieldType: "TEXT" });
    }
    const current = await request("GET", `/api/forms/${template.id}`, undefined, cookies.ADMIN);
    const ids = (await current.json()).template.fields.map((f: { id: number }) => f.id);

    const res = await request(
      "PUT",
      `/api/forms/${template.id}/fields/order`,
      { fieldIds: [ids[2], ids[0], ids[1]] },
      cookies.ADMIN,
    );
    assert.equal(res.status, 200);
    const fields = (await res.json()).template.fields;
    assert.deepEqual(
      fields.map((f: { label: string; position: number }) => [f.label, f.position]),
      [["C", 1], ["A", 2], ["B", 3]],
    );
  });

  test("reorder rejects missing, duplicate or foreign ids", async () => {
    const template = await createTemplate();
    await addField(template.id, { label: "A", fieldType: "TEXT" });
    const res = await addField(template.id, { label: "B", fieldType: "TEXT" });
    const ids = (await res.json()).template.fields.map((f: { id: number }) => f.id);

    for (const fieldIds of [[ids[0]], [ids[0], ids[0]], [ids[0], 999999999], "x"]) {
      const bad = await request(
        "PUT",
        `/api/forms/${template.id}/fields/order`,
        { fieldIds },
        cookies.ADMIN,
      );
      assert.equal(bad.status, 400);
      assert.deepEqual((await bad.json()).fields, { fieldIds: "invalid" });
    }
  });

  test("USER cannot modify fields or publish", async () => {
    const template = await createTemplate();
    const checks = [
      request("POST", `/api/forms/${template.id}/fields`, { label: "X", fieldType: "TEXT" }, cookies.USER),
      request("PUT", `/api/forms/${template.id}/fields/order`, { fieldIds: [] }, cookies.USER),
      request("PATCH", `/api/forms/${template.id}`, { name: "X" }, cookies.USER),
      request("POST", `/api/forms/${template.id}/publish`, undefined, cookies.USER),
      request("DELETE", `/api/forms/${template.id}`, undefined, cookies.USER),
    ];
    for (const res of await Promise.all(checks)) assert.equal(res.status, 403);
  });
});

describe("publishing and visibility", () => {
  test("cannot publish a template without fields", async () => {
    const template = await createTemplate();
    const res = await request("POST", `/api/forms/${template.id}/publish`, undefined, cookies.ADMIN);
    assert.equal(res.status, 409);
  });

  test("ADMIN can publish and unpublish; published templates cannot be edited", async () => {
    const template = await createTemplate();
    await addField(template.id, { label: "Nimi", fieldType: "TEXT" });

    let res = await request("POST", `/api/forms/${template.id}/publish`, undefined, cookies.ADMIN);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).template.status, "PUBLISHED");

    res = await addField(template.id, { label: "Lisä", fieldType: "TEXT" });
    assert.equal(res.status, 409);

    res = await request("POST", `/api/forms/${template.id}/unpublish`, undefined, cookies.ADMIN);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).template.status, "DRAFT");
  });

  test("unpublished templates are hidden from USER and PROFESSIONAL", async () => {
    const draft = await createTemplate();
    for (const role of ["USER", "PROFESSIONAL"] as const) {
      const list = await request("GET", "/api/forms", undefined, cookies[role]);
      assert.equal(list.status, 200);
      const ids = (await list.json()).templates.map((t: { id: number }) => t.id);
      assert.equal(ids.includes(draft.id), false, role);

      const single = await request("GET", `/api/forms/${draft.id}`, undefined, cookies[role]);
      assert.equal(single.status, 404, role);
    }

    const adminList = await request("GET", "/api/forms", undefined, cookies.ADMIN);
    const adminIds = (await adminList.json()).templates.map((t: { id: number }) => t.id);
    assert.equal(adminIds.includes(draft.id), true);
  });

  test("published templates are visible to authenticated users with ordered fields", async () => {
    const template = await createTemplate();
    await addField(template.id, { label: "Nimi", fieldType: "TEXT", required: true });
    await addField(template.id, { label: "Ikä", fieldType: "NUMBER" });
    await request("POST", `/api/forms/${template.id}/publish`, undefined, cookies.ADMIN);

    for (const role of ["USER", "PROFESSIONAL"] as const) {
      const list = await request("GET", "/api/forms", undefined, cookies[role]);
      const listed = (await list.json()).templates.find((t: { id: number }) => t.id === template.id);
      assert.ok(listed, role);
      assert.equal(listed.fieldCount, 2);

      const res = await request("GET", `/api/forms/${template.id}`, undefined, cookies[role]);
      assert.equal(res.status, 200, role);
      const { fields } = (await res.json()).template;
      assert.deepEqual(fields.map((f: { label: string }) => f.label), ["Nimi", "Ikä"]);
    }
  });

  test("ADMIN can delete a draft template", async () => {
    const template = await createTemplate();
    await addField(template.id, { label: "Nimi", fieldType: "TEXT" });
    const res = await request("DELETE", `/api/forms/${template.id}`, undefined, cookies.ADMIN);
    assert.equal(res.status, 204);
    const get = await request("GET", `/api/forms/${template.id}`, undefined, cookies.ADMIN);
    assert.equal(get.status, 404);
  });
});
