// AI question explanations (Issue #14). Ollama is replaced by a local mock server,
// so these tests never need a running Ollama. Users and forms are synthetic and deleted afterwards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { buildExplainMessages, EXPLANATION_MAX, SYSTEM_PROMPT } from "../src/ai/explain.js";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";

const PASSWORD = "testisalasana-123";
const createdEmails: string[] = [];
const createdTemplateIds: number[] = [];

// Distinctive values stored as the user's own data; none may ever reach Ollama.
const SUBMITTED_MARKER = "AIEMPI-VASTAUS-7Q2";
const DRAFT_MARKER = "LUONNOS-VASTAUS-9K4";

type TestUser = { cookie: string; id: number; email: string };

let baseUrl: string;
let server: ReturnType<typeof app.listen>;
let user: TestUser;
let admin: TestUser;

// Mock Ollama: each test sets `mockReply`; every request body is recorded.
type MockReply = (res: ServerResponse) => void;
let mock: Server;
let mockUrl: string;
let mockReply: MockReply;
let ollamaRequests: { url: string; body: unknown }[] = [];
const originalAi = { ...config.ai };

const replyWith = (content: unknown): MockReply => (res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ model: "mock", message: { role: "assistant", content }, done: true }));
};

const question = {
  question: "Kuinka kauan oire on jatkunut?",
  description: "Arvioi aika ensimmäisestä oireesta.",
  fieldType: "TEXT",
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

// `null` sends the request without a session.
const explain = (body: unknown, cookie: string | null = user.cookie) =>
  request("POST", "/api/ai/explain", body, cookie ?? undefined);

async function createUser(role: "USER" | "ADMIN"): Promise<TestUser> {
  const email = `ai-test-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const res = await request("POST", "/api/auth/register", { email, password: PASSWORD });
  assert.equal(res.status, 201);
  const body = await res.json();
  await pool.query("UPDATE users SET role = ? WHERE email = ?", [role, email]);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("la_session="));
  assert.ok(cookie);
  return { cookie: cookie.split(";")[0], id: body.user.id, email };
}

async function assertSafeUnavailable(res: Response) {
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "AI unavailable" });
}

before(async () => {
  mock = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      ollamaRequests.push({ url: req.url ?? "", body: JSON.parse(raw) });
      mockReply(res);
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", () => resolve()));
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await createUser("ADMIN");
  user = await createUser("USER");

  // Give the user a submitted form and a draft, so there is private data that could leak.
  let res = await request("POST", "/api/forms", { name: `AI-testilomake ${randomUUID()}` }, admin.cookie);
  const { template } = await res.json();
  createdTemplateIds.push(template.id);
  res = await request("POST", `/api/forms/${template.id}/fields`, { label: question.question, fieldType: "TEXT" }, admin.cookie);
  const fieldId = (await res.json()).template.fields[0].id;
  await request("POST", `/api/forms/${template.id}/publish`, undefined, admin.cookie);
  res = await request("POST", "/api/submissions", { formTemplateId: template.id, answers: { [fieldId]: SUBMITTED_MARKER } }, user.cookie);
  assert.equal(res.status, 201);
  res = await request("POST", "/api/submissions/draft", { formTemplateId: template.id, answers: { [fieldId]: DRAFT_MARKER } }, user.cookie);
  assert.equal(res.status, 201);
});

beforeEach(() => {
  Object.assign(config.ai, { baseUrl: mockUrl, model: "test-model", timeoutMs: 2000 });
  mockReply = replyWith("Tässä kysytään, kuinka pitkään oire on jatkunut. Voit vastata esimerkiksi 3 päivää.");
  ollamaRequests = [];
});

after(async () => {
  Object.assign(config.ai, originalAi);
  if (createdEmails.length > 0) {
    await pool.query("DELETE FROM users WHERE email IN (?)", [createdEmails]);
  }
  if (createdTemplateIds.length > 0) {
    await pool.query("DELETE FROM form_templates WHERE id IN (?)", [createdTemplateIds]);
  }
  mock.closeAllConnections();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("access and validation", () => {
  test("unauthenticated request gets 401 and Ollama is not called", async () => {
    const res = await explain(question, null);
    assert.equal(res.status, 401);
    assert.equal(ollamaRequests.length, 0);
  });

  test("authenticated valid request returns an explanation", async () => {
    const res = await explain(question);
    assert.equal(res.status, 200);
    assert.equal(ollamaRequests.length, 1);
  });

  test("empty or missing question is rejected", async () => {
    for (const body of [{ ...question, question: "   " }, { fieldType: "TEXT" }]) {
      const res = await explain(body);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).fields.question, "required");
    }
    assert.equal(ollamaRequests.length, 0);
  });

  test("too long question and description are rejected", async () => {
    let res = await explain({ ...question, question: "a".repeat(256) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).fields.question, "too_long");
    res = await explain({ ...question, description: "a".repeat(2001) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).fields.description, "too_long");
    assert.equal(ollamaRequests.length, 0);
  });

  test("invalid or missing field type is rejected", async () => {
    let res = await explain({ ...question, fieldType: "DIAGNOSIS" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).fields.fieldType, "invalid");
    res = await explain({ question: question.question });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).fields.fieldType, "required");
    assert.equal(ollamaRequests.length, 0);
  });

  test("options are only accepted for SELECT", async () => {
    let res = await explain({ ...question, options: ["Kyllä", "Ei"] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).fields.options, "not_allowed");
    res = await explain({ question: "Onko sinulla ollut huimausta?", fieldType: "SELECT", options: ["Kyllä", "Ei"] });
    assert.equal(res.status, 200);
  });

  test("answers, user ids and other extra keys are rejected, not forwarded", async () => {
    const res = await explain({
      ...question,
      answer: DRAFT_MARKER,
      answers: { 1: SUBMITTED_MARKER },
      previousData: [SUBMITTED_MARKER],
      userId: user.id,
    });
    assert.equal(res.status, 400);
    const { fields } = await res.json();
    for (const key of ["answer", "answers", "previousData", "userId"]) assert.equal(fields[key], "not_allowed");
    assert.equal(ollamaRequests.length, 0);
  });
});

describe("privacy boundary", () => {
  test("Ollama receives exactly the controlled prompt and question metadata", async () => {
    const select = {
      question: "Onko sinulla ollut huimausta?",
      description: "Viimeisen viikon aikana.",
      fieldType: "SELECT",
      options: ["Kyllä", "Ei"],
    };
    const res = await explain(select);
    assert.equal(res.status, 200);
    assert.equal(ollamaRequests.length, 1);
    const sent = ollamaRequests[0];
    assert.equal(sent.url, "/api/chat");
    assert.deepEqual(sent.body, {
      model: "test-model",
      messages: buildExplainMessages({ ...select, fieldType: "SELECT" }),
      stream: false,
      options: { temperature: 0.2, num_predict: 300 },
    });
    const messages = (sent.body as { messages: { role: string; content: string }[] }).messages;
    assert.equal(messages[0].content, SYSTEM_PROMPT);
    assert.equal(
      messages[1].content,
      "Selitä tämä lomakkeen kysymys.\n\nKysymys: Onko sinulla ollut huimausta?\nOhjeteksti: Viimeisen viikon aikana.\nVastauksen muoto: valinta annetuista vaihtoehdoista\nVaihtoehdot: Kyllä; Ei",
    );
  });

  test("user id, email, previous answers and draft answers are not sent", async () => {
    const res = await explain(question);
    assert.equal(res.status, 200);
    const payload = JSON.stringify(ollamaRequests[0].body);
    assert.ok(!payload.includes(SUBMITTED_MARKER), "previous submission sent to Ollama");
    assert.ok(!payload.includes(DRAFT_MARKER), "draft answer sent to Ollama");
    assert.ok(!payload.includes(user.email), "email sent to Ollama");
    assert.ok(!/user_?id/i.test(payload), "user id field sent to Ollama");
    assert.ok(!payload.includes(`"${user.id}"`) && !payload.includes(`:${user.id},`), "user id sent to Ollama");
    assert.ok(!/LA-[2-9A-Z]{6}/.test(payload), "reference code sent to Ollama");
  });
});

describe("responses and failures", () => {
  test("successful response returns only the trimmed explanation text", async () => {
    mockReply = replyWith("  Tässä kysytään oireen kestoa.  ");
    const res = await explain(question);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { explanation: "Tässä kysytään oireen kestoa." });
  });

  test("overlong output is capped", async () => {
    mockReply = replyWith("a".repeat(EXPLANATION_MAX * 3));
    const res = await explain(question);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).explanation.length, EXPLANATION_MAX);
  });

  test("Ollama not configured gives 503", async () => {
    config.ai.baseUrl = "";
    await assertSafeUnavailable(await explain(question));
  });

  test("Ollama unreachable gives a safe 503", async () => {
    // A port that was free a moment ago: nothing is listening there.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    config.ai.baseUrl = `http://127.0.0.1:${port}`;
    await assertSafeUnavailable(await explain(question));
  });

  test("Ollama timeout gives a safe 503", async () => {
    config.ai.timeoutMs = 200;
    mockReply = () => {}; // never answers
    const started = Date.now();
    await assertSafeUnavailable(await explain(question));
    assert.ok(Date.now() - started < 1500, "request was not cut off by the timeout");
  });

  test("Ollama error details are not exposed", async () => {
    mockReply = (res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "model 'secret-model' not found at /root/.ollama/models; stack: at runner.go:42" }));
    };
    const res = await explain(question);
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: "AI unavailable" });
    for (const leak of ["secret-model", ".ollama", "runner.go", "127.0.0.1", "test-model"]) {
      assert.ok(!text.includes(leak), `response leaked ${leak}`);
    }
  });

  test("invalid Ollama responses give a safe 503", async () => {
    const replies: MockReply[] = [
      (res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("not json");
      },
      replyWith(""),
      replyWith({ nested: "object" }),
      (res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ done: true }));
      },
    ];
    for (const reply of replies) {
      mockReply = reply;
      await assertSafeUnavailable(await explain(question));
    }
  });
});
