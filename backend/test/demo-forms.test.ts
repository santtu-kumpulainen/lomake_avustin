// Demo form library (Issue #24). Integration tests against the configured MariaDB (synthetic data only).
// Seeds the real demo content under run-specific seed keys, so forms seeded for the app are never
// touched, and deletes everything it created afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { DEMO_FORMS, seedDemoForms, validateDemoForm, type DemoForm } from "../src/seeds/demo-forms.js";

const PASSWORD = "testisalasana-123";
const RUN = randomUUID().slice(0, 8);
const KEY_PREFIX = `test-${RUN}-`;
const createdEmails: string[] = [];
const createdTemplateIds: number[] = [];

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
const cookies: Record<"ADMIN" | "USER" | "PROFESSIONAL", string> = { ADMIN: "", USER: "", PROFESSIONAL: "" };

// The real demo content, renamed so it cannot collide with the app's own seeded forms.
function testForms(suffix: string): DemoForm[] {
  return DEMO_FORMS.map((form) => ({
    ...form,
    key: `${KEY_PREFIX}${suffix}-${form.key}`,
    name: `${form.name} (${RUN}-${suffix})`,
  }));
}

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
  const email = `demo-forms-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  await pool.query("UPDATE users SET role = ? WHERE email = ?", [role, email]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return cookie.split(";")[0];
}

type TemplateRow = { id: number; name: string; status: string; category: string | null; seed_key: string };

async function seededRows(keys: string[]): Promise<TemplateRow[]> {
  return pool.query(
    "SELECT id, name, status, category, seed_key FROM form_templates WHERE seed_key IN (?) ORDER BY id",
    [keys],
  );
}

async function fieldCount(templateIds: number[]): Promise<number> {
  const [row] = await pool.query("SELECT COUNT(*) AS n FROM form_fields WHERE form_template_id IN (?)", [
    templateIds,
  ]);
  return Number(row.n);
}

async function seed(forms: DemoForm[]) {
  const result = await seedDemoForms(pool, forms);
  const rows = await seededRows(forms.map((form) => form.key));
  createdTemplateIds.push(...rows.map((row) => row.id).filter((id) => !createdTemplateIds.includes(id)));
  return { result, rows };
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
  // Users first: their submissions reference the templates (ON DELETE RESTRICT).
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  await pool.query("DELETE FROM form_templates WHERE seed_key LIKE ?", [`${KEY_PREFIX}%`]);
  if (createdTemplateIds.length > 0) {
    await pool.query("DELETE FROM form_templates WHERE id IN (?)", [createdTemplateIds]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("demo form content", () => {
  test("library has 8 distinct forms of 5-8 valid fields each", () => {
    assert.equal(DEMO_FORMS.length, 8);
    assert.equal(new Set(DEMO_FORMS.map((form) => form.key)).size, 8);
    assert.equal(new Set(DEMO_FORMS.map((form) => form.name)).size, 8);
    assert.deepEqual(
      DEMO_FORMS.map((form) => form.name),
      [
        "Vastaanoton esitiedot",
        "Oireiden esitiedot",
        "Kivun esitiedot",
        "Mielialan ja hyvinvoinnin esitiedot",
        "Unen ja palautumisen esitiedot",
        "Lääkitystiedot",
        "Allergiatiedot",
        "Toimintakyvyn esitiedot",
      ],
    );
    const types = new Set<string>();
    for (const form of DEMO_FORMS) {
      assert.ok(form.description, form.key);
      assert.ok(form.category, form.key);
      assert.ok(form.fields.length >= 5 && form.fields.length <= 8, form.key);
      assert.ok(form.fields.some((field) => field.required), `${form.key} has a required field`);
      assert.ok(form.fields.some((field) => !field.required), `${form.key} has an optional field`);
      // Throws if any field breaks the admin API's validation rules.
      validateDemoForm(form);
      form.fields.forEach((field) => types.add(field.fieldType));
    }
    assert.deepEqual([...types].sort(), ["DATE", "NUMBER", "SELECT", "TEXT"]);
  });

  test("invalid demo data is rejected before anything is written", async () => {
    const [good] = testForms("invalid");
    const bad: DemoForm = {
      ...good,
      key: `${KEY_PREFIX}invalid-bad`,
      fields: [{ label: "Valinta", fieldType: "SELECT", options: [] }],
    };
    await assert.rejects(seedDemoForms(pool, [good, bad]), /Invalid demo form/);
    assert.equal((await seededRows([good.key, bad.key])).length, 0);
  });
});

describe("seeding", () => {
  const forms = testForms("seed");

  test("creates every form as PUBLISHED with category and ordered fields", async () => {
    const { result, rows } = await seed(forms);
    assert.deepEqual(result.created, forms.map((form) => form.key));
    assert.deepEqual(result.skipped, []);
    assert.equal(rows.length, 8);

    for (const [index, form] of forms.entries()) {
      const row = rows[index];
      assert.equal(row.name, form.name);
      assert.equal(row.status, "PUBLISHED");
      assert.equal(row.category, form.category);
      const fields: { label: string; field_type: string; is_required: number; position: number; options: unknown }[] =
        await pool.query(
          "SELECT label, field_type, is_required, position, options FROM form_fields WHERE form_template_id = ? ORDER BY position",
          [row.id],
        );
      assert.deepEqual(
        fields.map((field) => [field.label, field.field_type, Boolean(field.is_required), field.position]),
        form.fields.map((field, i) => [field.label, field.fieldType, Boolean(field.required), i + 1]),
      );
    }
  });

  test("running again creates nothing and changes nothing", async () => {
    const before = await seededRows(forms.map((form) => form.key));
    const fieldsBefore = await fieldCount(before.map((row) => row.id));

    const { result, rows } = await seed(forms);
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.skipped, forms.map((form) => form.key));
    assert.deepEqual(rows, before);
    assert.equal(await fieldCount(rows.map((row) => row.id)), fieldsBefore);
  });

  test("concurrent runs still create each form once", async () => {
    const parallel = testForms("parallel");
    const results = await Promise.all([seedDemoForms(pool, parallel), seedDemoForms(pool, parallel)]);
    const { rows } = await seed(parallel);
    assert.equal(rows.length, 8);
    assert.equal(results[0].created.length + results[1].created.length, 8);
    assert.equal(await fieldCount(rows.map((row) => row.id)), DEMO_FORMS.reduce((n, f) => n + f.fields.length, 0));
  });

  test("admin edits survive a new seed run", async () => {
    const [form] = forms;
    const [row] = await seededRows([form.key]);

    assert.equal((await request("POST", `/api/forms/${row.id}/unpublish`, undefined, cookies.ADMIN)).status, 200);
    const renamed = await request(
      "PATCH",
      `/api/forms/${row.id}`,
      { name: `Muokattu ${RUN}`, category: "Muokattu luokka" },
      cookies.ADMIN,
    );
    assert.equal(renamed.status, 200);
    const added = await request(
      "POST",
      `/api/forms/${row.id}/fields`,
      { label: "Ylläpitäjän lisäämä", fieldType: "TEXT" },
      cookies.ADMIN,
    );
    assert.equal(added.status, 201);
    const fieldsAfterEdit = await fieldCount([row.id]);

    const { result } = await seed(forms);
    assert.ok(result.skipped.includes(form.key));
    const after = await seededRows(forms.map((f) => f.key));
    assert.equal(after.length, 8, "renamed form is not recreated");
    const edited = after.find((r) => r.id === row.id)!;
    assert.equal(edited.name, `Muokattu ${RUN}`);
    assert.equal(edited.category, "Muokattu luokka");
    assert.equal(edited.status, "DRAFT", "unpublished form stays unpublished");
    assert.equal(await fieldCount([row.id]), fieldsAfterEdit);
  });

  test("seed never removes other templates", async () => {
    const res = await request("POST", "/api/forms", { name: `Oma pohja ${RUN}` }, cookies.ADMIN);
    const { template } = await res.json();
    createdTemplateIds.push(template.id);
    await seed(forms);
    const [row] = await pool.query("SELECT id, seed_key FROM form_templates WHERE id = ?", [template.id]);
    assert.equal(row.id, template.id);
    assert.equal(row.seed_key, null);
  });
});

describe("seeded forms through the API", () => {
  const forms = testForms("api");
  let rows: TemplateRow[];

  before(async () => {
    ({ rows } = await seed(forms));
  });

  test("USER sees published demo forms with category and description, never the seed key", async () => {
    const res = await request("GET", "/api/forms", undefined, cookies.USER);
    assert.equal(res.status, 200);
    const { templates } = await res.json();
    for (const [index, form] of forms.entries()) {
      const listed = templates.find((t: { id: number }) => t.id === rows[index].id);
      assert.ok(listed, form.key);
      assert.equal(listed.category, form.category);
      assert.equal(listed.description, form.description);
      assert.equal(listed.fieldCount, form.fields.length);
      assert.equal("seedKey" in listed || "seed_key" in listed, false);
    }
  });

  test("USER gets the fields of a demo form in order", async () => {
    const form = forms.find((f) => f.fields.some((field) => field.fieldType === "SELECT"))!;
    const row = rows[forms.indexOf(form)];
    const res = await request("GET", `/api/forms/${row.id}`, undefined, cookies.USER);
    assert.equal(res.status, 200);
    const { template } = await res.json();
    assert.equal(template.category, form.category);
    assert.deepEqual(
      template.fields.map((f: { label: string; fieldType: string; required: boolean; options: string[] | null }) => [
        f.label,
        f.fieldType,
        f.required,
        f.options,
      ]),
      form.fields.map((f) => [f.label, f.fieldType, Boolean(f.required), f.options ?? null]),
    );
  });

  test("an unpublished demo form is hidden from USER and PROFESSIONAL", async () => {
    const row = rows[1];
    assert.equal((await request("POST", `/api/forms/${row.id}/unpublish`, undefined, cookies.ADMIN)).status, 200);
    for (const role of ["USER", "PROFESSIONAL"] as const) {
      const list = await (await request("GET", "/api/forms", undefined, cookies[role])).json();
      assert.equal(list.templates.some((t: { id: number }) => t.id === row.id), false, role);
      assert.equal((await request("GET", `/api/forms/${row.id}`, undefined, cookies[role])).status, 404, role);
    }
    // ADMIN still sees it to edit and republish.
    const admin = await (await request("GET", "/api/forms", undefined, cookies.ADMIN)).json();
    assert.equal(admin.templates.find((t: { id: number }) => t.id === row.id).status, "DRAFT");
    assert.equal((await request("POST", `/api/forms/${row.id}/publish`, undefined, cookies.ADMIN)).status, 200);
  });

  test("only ADMIN can change demo forms", async () => {
    const row = rows[2];
    for (const cookie of [cookies.USER, cookies.PROFESSIONAL]) {
      assert.equal((await request("POST", `/api/forms/${row.id}/unpublish`, undefined, cookie)).status, 403);
      assert.equal((await request("PATCH", `/api/forms/${row.id}`, { category: "X" }, cookie)).status, 403);
    }
    assert.equal((await request("POST", `/api/forms/${row.id}/unpublish`)).status, 401);
    const [after] = await seededRows([row.seed_key]);
    assert.equal(after.status, "PUBLISHED");
    assert.equal(after.category, forms[2].category);
  });

  test("USER can save a draft of and submit a demo form", async () => {
    const form = forms[0];
    const { template } = await (await request("GET", `/api/forms/${rows[0].id}`, undefined, cookies.USER)).json();
    const answers: Record<string, string> = {};
    for (const field of template.fields as { id: number; fieldType: string; options: string[] | null }[]) {
      answers[field.id] =
        field.fieldType === "SELECT" ? field.options![0] : field.fieldType === "DATE" ? "2026-09-30" : field.fieldType === "NUMBER" ? "4,5" : "Synteettinen vastaus";
    }
    assert.equal(template.fields.length, form.fields.length);

    const draft = await request("POST", "/api/submissions/draft", { formTemplateId: rows[0].id, answers: {} }, cookies.USER);
    assert.equal(draft.status, 201);
    const { submission } = await draft.json();
    const submitted = await request("POST", `/api/submissions/${submission.id}/submit`, { answers }, cookies.USER);
    assert.equal(submitted.status, 200);
    const body = await submitted.json();
    assert.equal(body.submission.status, "SUBMITTED");
    assert.match(body.submission.referenceCode, /^LA-/);
  });

  test("required demo fields are enforced on submit", async () => {
    const res = await request("POST", "/api/submissions", { formTemplateId: rows[0].id, answers: {} }, cookies.USER);
    assert.equal(res.status, 400);
    const { fields } = await res.json();
    const { template } = await (await request("GET", `/api/forms/${rows[0].id}`, undefined, cookies.USER)).json();
    const requiredIds = template.fields.filter((f: { required: boolean }) => f.required).map((f: { id: number }) => String(f.id));
    assert.deepEqual(Object.keys(fields).sort(), requiredIds.sort());
  });
});

describe("template category", () => {
  async function create(body: Record<string, unknown>) {
    const res = await request("POST", "/api/forms", body, cookies.ADMIN);
    const json = await res.json();
    if (json.template) createdTemplateIds.push(json.template.id);
    return { status: res.status, json };
  }

  test("is optional and null by default", async () => {
    const { status, json } = await create({ name: `Ilman luokkaa ${RUN}` });
    assert.equal(status, 201);
    assert.equal(json.template.category, null);
  });

  test("ADMIN can set, keep, change and clear it", async () => {
    const { json } = await create({ name: `Luokallinen ${RUN}`, category: "  Kipu  " });
    const id = json.template.id;
    assert.equal(json.template.category, "Kipu");

    let res = await request("PATCH", `/api/forms/${id}`, { name: `Uusi nimi ${RUN}` }, cookies.ADMIN);
    assert.equal((await res.json()).template.category, "Kipu", "missing key keeps the category");
    res = await request("PATCH", `/api/forms/${id}`, { category: "Uni ja palautuminen" }, cookies.ADMIN);
    assert.equal((await res.json()).template.category, "Uni ja palautuminen");
    res = await request("PATCH", `/api/forms/${id}`, { category: "" }, cookies.ADMIN);
    assert.equal((await res.json()).template.category, null);
  });

  test("is validated", async () => {
    let result = await create({ name: `Pitkä ${RUN}`, category: "x".repeat(101) });
    assert.equal(result.status, 400);
    assert.equal(result.json.fields.category, "too_long");
    result = await create({ name: `Väärä ${RUN}`, category: 5 });
    assert.equal(result.status, 400);
    assert.equal(result.json.fields.category, "invalid");
    result = await create({ name: `Raja ${RUN}`, category: "x".repeat(100) });
    assert.equal(result.status, 201);
  });
});
