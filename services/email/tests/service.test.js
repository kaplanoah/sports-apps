import assert from "node:assert/strict";
import test from "node:test";
import { createEmailService } from "../worker/src/service.js";
import { createAppWorker } from "../../../shared/worker/app-worker.js";
import { createTestOutbox } from "./fake-outbox.js";

const ID = "23428fa1-9250-4f13-b567-c094f8bdc448";
const REPORT = {
  id: ID,
  category: "bug",
  message: "The score stopped",
  email: "",
  screenshot: null,
};
const SENDER = "a".repeat(64);

function createService() {
  const box = createTestOutbox({ ...REPORT, app: "mlb" });
  const env = {
    ...box.env,
    VERSION: { tag: "abc1234" },
    STORE: { idFromName: (name) => name, get: () => box.outbox },
  };
  return { box, env, service: createEmailService(env) };
}

test("one email configuration serves every league without exposing its key or sender", async () => {
  const { box, env, service } = createService();
  assert.deepEqual(service.readContactConfig(), { email: "owner@example.com" });
  for (const app of ["mlb", "wnba", "future-league"]) {
    const response = await service.submitContact({ app, submission: REPORT, sender: SENDER });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true, id: ID });
    assert.ok(box.values.has(`pending:${app}/${ID}`));
  }
  assert.equal(box.calls.length, 0);
  const health = await service.readHealth();
  assert.deepEqual(health, { ok: true, release: "abc1234" });
  assert.ok(!JSON.stringify(health).includes(env.CONTACT_MAIL_KEY));
});

test("the same visitor identifier in two leagues has separate receipts and provider keys", async () => {
  const { box, service } = createService();
  for (const app of ["mlb", "wnba"]) {
    assert.equal(
      (await service.submitContact({ app, submission: REPORT, sender: SENDER })).status,
      202,
    );
    assert.equal(
      (await service.submitContact({ app, submission: REPORT, sender: SENDER })).status,
      200,
    );
  }
  await box.wake();
  await box.wake();
  assert.deepEqual(
    box.calls.map(({ init }) => init.headers["idempotency-key"]),
    [`contact/mlb/${ID}`, `contact/wnba/${ID}`],
  );
  assert.deepEqual(
    box.calls.map(({ init }) => JSON.parse(init.body).subject),
    ["MLB: Bug report", "WNBA: Bug report"],
  );
});

test("one league cannot consume another league's sender limit or pending capacity", async () => {
  const { box, service } = createService();
  for (let index = 0; index < 5; index += 1)
    assert.equal(
      (
        await service.submitContact({
          app: "mlb",
          submission: { ...REPORT, id: `${ID.slice(0, -1)}${index}` },
          sender: SENDER,
        })
      ).status,
      202,
    );
  assert.equal(
    (await service.submitContact({ app: "mlb", submission: REPORT, sender: SENDER })).status,
    429,
  );
  assert.equal(
    (await service.submitContact({ app: "wnba", submission: REPORT, sender: SENDER })).status,
    202,
  );
  for (let index = 0; index < 100; index += 1)
    box.values.set(`pending:mlb/fill-${index}`, {
      app: "mlb",
      createdAt: box.clock.now,
      state: "queued",
    });
  assert.equal(
    (await service.submitContact({ app: "mlb", submission: REPORT, sender: "b".repeat(64) }))
      .status,
    429,
  );
  assert.equal(
    (await service.submitContact({ app: "future", submission: REPORT, sender: SENDER })).status,
    202,
  );
});

test("the service revalidates input, strips supplied routing fields, and refuses malformed sources", async () => {
  const { box, service } = createService();
  for (const changed of [
    { app: undefined },
    { app: "../wnba" },
    { app: "MLB" },
    { sender: "raw-address" },
    { submission: { ...REPORT, message: "" } },
    { submission: { ...REPORT, screenshot: { type: "image/png", content: btoa("not-an-image") } } },
  ])
    assert.equal(
      (await service.submitContact({ app: "mlb", submission: REPORT, sender: SENDER, ...changed }))
        .status,
      400,
    );
  assert.equal(box.values.size, 0);
  const response = await service.submitContact({
    app: "mlb",
    sender: SENDER,
    submission: {
      ...REPORT,
      app: "wnba",
      from: "spoof@example.com",
      to: "other@example.com",
      diagnostics: "https://private.example/secret",
    },
  });
  assert.equal(response.status, 202);
  await box.wake();
  const mail = JSON.parse(box.calls[0].init.body);
  assert.equal(mail.from, "reports@example.com");
  assert.deepEqual(mail.to, ["owner@example.com"]);
  assert.equal(mail.subject, "MLB: Bug report");
  assert.doesNotMatch(mail.text, /private\.example|secret/);
});

test("missing configuration and storage failures refuse acceptance and expose no private error", async () => {
  for (const name of ["CONTACT_FROM", "CONTACT_TO", "CONTACT_MAIL_KEY", "STORE"]) {
    const { env } = createService();
    delete env[name];
    const service = createEmailService(env);
    assert.deepEqual(service.readContactConfig(), { email: null });
    assert.deepEqual(await service.readHealth(), {
      ok: false,
      release: "abc1234",
      problem: "Contact mail is not configured",
    });
    assert.equal(
      (await service.submitContact({ app: "mlb", submission: REPORT, sender: SENDER })).status,
      503,
    );
  }
  const { box, service } = createService();
  box.rejectWrites();
  const response = await service.submitContact({ app: "mlb", submission: REPORT, sender: SENDER });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { problem: "unavailable" });
  assert.equal(box.values.size, 0);
});

test("a backlog asks for attention while the service still answers, and a lost outbox fails health, disclosing no report", async () => {
  const { box, service } = createService();
  await service.submitContact({ app: "mlb", submission: REPORT, sender: SENDER });
  box.clock.now += 60 * 60 * 1000 + 1;
  assert.deepEqual(await service.readHealth(), {
    ok: true,
    release: "abc1234",
    attention: "Contact delivery needs attention",
  });
  box.outbox.fetch = async () => {
    throw new Error("private-message");
  };
  assert.deepEqual(await service.readHealth(), {
    ok: false,
    release: "abc1234",
    problem: "its outbox doesn't answer",
  });
});

test("both apps reach the same service through their gated endpoint and fix their own source", async () => {
  const { box, service } = createService();
  for (const name of ["mlb", "wnba"]) {
    const app = createAppWorker({
      name,
      pageFiles: {},
      forwardToStore: () => new Response(),
      readFeedFailures: async () => ({}),
    });
    const env = { APP_KEY: "k3y", EMAIL: service };
    const config = await app.fetch(new Request("https://example.com/k3y/contact"), env);
    assert.deepEqual(await config.json(), { email: "owner@example.com" });
    const response = await app.fetch(
      new Request("https://example.com/k3y/contact", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          "cf-connecting-ip": "192.0.2.1",
        },
        body: JSON.stringify({ ...REPORT, app: "visitor-controlled" }),
      }),
      env,
    );
    assert.equal(response.status, 202);
    assert.ok(box.values.has(`pending:${name}/${ID}`));
  }
  assert.equal((await box.ctx.storage.list({ prefix: "pending:" })).size, 2);
});
