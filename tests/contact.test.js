import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_LIMITS,
  validateContactFields,
  validateContactScreenshot,
} from "../shared/page/contact-rules.js";
import {
  readContactRequest,
  serveContact as serveAppContact,
} from "../shared/worker/contact-request.js";
import { createAppWorker } from "../shared/worker/app-worker.js";
import { createHealthServer } from "../shared/worker/health.js";

const serveContact = (request, env) => serveAppContact(request, env, "mlb");

const ID = "23428fa1-9250-4f13-b567-c094f8bdc448";
const SUBMISSION = {
  id: ID,
  category: "bug",
  message: "The score stays still",
  email: "fan@example.com",
  screenshot: null,
};
const ENV = { EMAIL: {} };
/** @param {any} [body] @param {Record<string, string>} [headers] */
const createRequest = (body = SUBMISSION, headers = {}) =>
  new Request("https://example.com/contact", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", ...headers },
    body: JSON.stringify(body),
  });

test("the form's limits read as the limits they check", () => {
  const message = "x".repeat(CONTACT_LIMITS.message);
  assert.equal(validateContactFields({ message, email: "" }), null);
  assert.equal(
    validateContactFields({ message: `${message}x`, email: "" }).text,
    "Keep your message to 10,000 characters or fewer",
  );
  const type = "image/png";
  assert.equal(validateContactScreenshot({ type, size: CONTACT_LIMITS.screenshot }), null);
  assert.equal(
    validateContactScreenshot({ type, size: CONTACT_LIMITS.screenshot + 1 }),
    "Choose a screenshot of 2 MB or less",
  );
  assert.equal(
    validateContactScreenshot({ type, size: 0 }),
    "Choose a screenshot that isn't empty",
  );
});

test("server accepts a valid optional email and redacts actual diagnostics URLs", async () => {
  const result = await readContactRequest(
    createRequest({
      ...SUBMISSION,
      email: "",
      diagnostics: "Opened https://private.example/secret?key=value",
    }),
  );
  assert.equal(result.email, "");
  assert.doesNotMatch(result.diagnostics, /private\.example|secret|key=value/);
});

test("server rejects invalid identifiers, fields and diagnostics outside bug reports", async () => {
  for (const changed of [
    { id: "invalid" },
    { category: "unknown" },
    { message: " " },
    { message: 123 },
    { message: "x".repeat(CONTACT_LIMITS.message + 1) },
    { email: "bad" },
    { diagnostics: false },
    { diagnostics: "x".repeat(CONTACT_LIMITS.diagnostics + 1) },
    { category: "feature", diagnostics: "private" },
  ])
    await assert.rejects(readContactRequest(createRequest({ ...SUBMISSION, ...changed })));
});

test("server bounds streamed request bodies and refuses other content types", async () => {
  await assert.rejects(
    readContactRequest(createRequest(SUBMISSION, { "content-type": "text/plain" })),
  );
  const request = new Request("https://example.com/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(CONTACT_LIMITS.request + 1),
  });
  await assert.rejects(readContactRequest(request), /size/);
});

test("screenshots require matching image signatures and receive safe filenames", async () => {
  const screenshot = { type: "image/png", filename: "../../bad.html", content: "iVBORw0KGgo=" };
  const result = await readContactRequest(createRequest({ ...SUBMISSION, screenshot }));
  assert.equal(result.screenshot.filename, "screenshot.png");
  for (const invalid of [
    { ...screenshot, content: btoa("<html>bad</html>") },
    { ...screenshot, type: "image/svg+xml" },
    { ...screenshot, content: "invalid!" },
    { ...screenshot, content: "A".repeat(Math.ceil(CONTACT_LIMITS.screenshot / 3) * 4 + 4) },
  ])
    await assert.rejects(readContactRequest(createRequest({ ...SUBMISSION, screenshot: invalid })));
});

test("endpoint requires configured delivery and durable server acceptance", async () => {
  assert.equal((await serveContact(createRequest(), {})).status, 503);
  let received;
  const env = {
    ...ENV,
    EMAIL: {
      submitContact: async (request) => {
        received = request;
        return Response.json({ accepted: true, id: ID }, { status: 202 });
      },
    },
  };
  const response = await serveContact(createRequest(), env);
  assert.equal(response.status, 202);
  assert.equal(received.submission.message, SUBMISSION.message);
  assert.match(received.sender, /^[a-f0-9]{64}$/);
  assert.equal(received.app, "mlb");
  env.EMAIL.submitContact = async () => {
    throw new Error("outage");
  };
  assert.equal((await serveContact(createRequest(), env)).status, 503);
});

test("endpoint answers a GET with the owner's address, or none while the service is down", async () => {
  const env = { EMAIL: { readContactConfig: async () => ({ email: "owner@example.com" }) } };
  const response = await serveContact(new Request("https://example.com/contact"), env);
  assert.deepEqual(await response.json(), { email: "owner@example.com" });
  const fallback = await serveContact(new Request("https://example.com/contact"), {});
  assert.equal(fallback.headers.get("cache-control"), "no-store");
  assert.equal(fallback.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await fallback.json(), { email: null });
});

test("endpoint refuses methods other than GET and POST", async () => {
  const response = await serveContact(
    new Request("https://example.com/contact", { method: "PUT" }),
    ENV,
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, POST");
});

test("Contact routes stay behind the app path and access gate", async () => {
  const worker = createAppWorker({
    name: "mlb",
    pageFiles: {},
    forwardToStore: () => new Response(),
    readStoreHealth: async () => ({ feeds: {} }),
  });
  const env = { APP_KEY: "test-key", ACCESS_CODE: "secret", ACCESS_SIGNING_KEY: "test-signing" };
  assert.equal((await worker.fetch(new Request("https://example.com/contact"), env)).status, 404);
  assert.equal(
    (await worker.fetch(new Request("https://example.com/test-key/contact"), env)).status,
    401,
  );
});

test("email service health is reported without exposing report content or affecting sports health", async () => {
  const serveHealth = createHealthServer({
    readStoreHealth: async () => ({ feeds: {} }),
    release: "abc",
  });
  const response = await serveHealth({
    EMAIL: {
      readHealth: async () => ({ ok: false, release: "def", private: "message", pending: 2 }),
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    release: "abc",
    store: "ok",
    feeds: {},
    services: { email: { ok: false, release: "def" } },
  });
});
