import test from "node:test";
import assert from "node:assert/strict";
import { createTestOutbox } from "../services/email/tests/fake-outbox.js";
import { EmailOutbox } from "../services/email/worker/src/outbox.js";

const ID = "23428fa1-9250-4f13-b567-c094f8bdc448";
const SUBMISSION = {
  id: ID,
  app: "mlb",
  category: "bug",
  message: "A score stopped changing",
  email: "fan@example.com",
  screenshot: null,
};

const createOutbox = () => createTestOutbox(SUBMISSION);

test("durable acceptance includes payload and alarm; concurrent retries create one report", async () => {
  const box = createOutbox();
  const responses = await Promise.all([box.submit(), box.submit(), box.submit()]);
  assert.deepEqual(
    responses.map(({ status }) => status),
    [202, 200, 200],
  );
  assert.equal((await box.ctx.storage.list({ prefix: "pending:" })).size, 1);
  assert.ok(await box.ctx.storage.getAlarm());
  assert.equal(box.calls.length, 0);
  assert.equal((await box.submit({ ...SUBMISSION, message: "different" })).status, 409);
});

test("a failed durable write never creates an acceptance receipt", async () => {
  const box = createOutbox();
  box.rejectWrites();
  await assert.rejects(box.submit());
  assert.equal(box.values.size, 0);
  assert.equal(await box.ctx.storage.getAlarm(), null);
});

test("a failed alarm rolls back the payload and receipt before acceptance", async () => {
  const box = createOutbox();
  box.rejectAlarms();
  await assert.rejects(box.submit());
  assert.equal(box.values.size, 0);
});

test("opened or clicked email confirms delivery even when tracking was enabled", async () => {
  for (const state of ["opened", "clicked"]) {
    const box = createOutbox();
    await box.submit();
    await box.wake();
    box.setProvider(async () => Response.json({ last_event: state }));
    await box.wake();
    assert.equal(box.values.has(`pending:mlb/${ID}`), false);
  }
});

test("an accepted email is never resent when delivery checks fail or expire", async () => {
  const box = createOutbox();
  await box.submit();
  await box.wake();
  box.setProvider(async () => new Response(null, { status: 503 }));
  await box.wake();
  assert.equal(box.calls.filter(({ init }) => init.method === "POST").length, 1);
  box.clock.now += 7 * 24 * 60 * 60 * 1000;
  await box.outbox.alarm();
  assert.equal(box.values.get(`pending:mlb/${ID}`).state, "attention");
});

test("screenshots and Unicode reports fit storage value limits and reconstruct exactly", async () => {
  const box = createOutbox();
  const submission = {
    ...SUBMISSION,
    diagnostics: "\u{1f3c0}".repeat(40000),
    screenshot: { filename: "screenshot.png", type: "image/png", content: "x".repeat(2800000) },
  };
  await box.submit(submission);
  const report = box.values.get(`pending:mlb/${ID}`);
  assert.ok(report.chunks > 100);
  assert.deepEqual(await box.outbox.readSubmission(report), {
    ...submission,
    app: "mlb",
    from: box.env.CONTACT_FROM,
    to: box.env.CONTACT_TO,
  });
});

test("provider acceptance remains pending until delivery is confirmed, then private payload is removed", async () => {
  const box = createOutbox();
  await box.submit();
  await box.wake();
  assert.equal(box.values.get(`pending:mlb/${ID}`).state, "accepted-by-provider");
  assert.match(JSON.parse(box.calls[0].init.body).subject, /^MLB: Bug report/);
  box.setProvider(async () => Response.json({ last_event: "delivered" }));
  await box.wake();
  assert.equal(box.values.has(`pending:mlb/${ID}`), false);
  assert.equal((await box.ctx.storage.list({ prefix: "payload:" })).size, 0);
  assert.ok(box.values.has(`receipt:mlb/${ID}`));
  assert.equal((await box.submit()).status, 200);
  assert.equal(box.calls.length, 2);
});

test("uncertain provider responses survive a restart and retry with the same mail identifier and frozen recipient", async () => {
  const box = createOutbox();
  box.setProvider(async () => {
    throw new Error("connection-lost-after-send");
  });
  await box.submit();
  await box.wake();
  assert.ok(await box.ctx.storage.getAlarm());
  const restarted = new EmailOutbox(
    box.ctx,
    { ...box.env, CONTACT_TO: "changed@example.com" },
    box.options,
  );
  box.clock.now = await box.ctx.storage.getAlarm();
  box.setProvider(async () => Response.json({ id: "provider-id" }));
  await restarted.alarm();
  assert.equal(box.calls.length, 2);
  assert.equal(
    box.calls[0].init.headers["idempotency-key"],
    box.calls[1].init.headers["idempotency-key"],
  );
  assert.equal(box.calls[0].init.body, box.calls[1].init.body);
});

test("provider outages keep retrying; uncertainty stops before the provider deduplication window expires", async () => {
  const box = createOutbox();
  box.setProvider(async () => new Response(null, { status: 503 }));
  await box.submit();
  await box.wake();
  await box.wake();
  assert.equal(box.calls.length, 2);
  box.clock.now += 23 * 60 * 60 * 1000;
  await box.outbox.alarm();
  assert.equal(box.calls.length, 2);
  assert.equal(box.values.get(`pending:mlb/${ID}`).state, "attention");
  assert.ok(box.values.has(`payload:mlb/${ID}:0`));
  assert.equal((await (await box.outbox.readStatus()).json()).ok, false);
});

test("a bounce retains the report for recovery and marks health as needing attention", async () => {
  const box = createOutbox();
  await box.submit();
  await box.wake();
  box.setProvider(async () => Response.json({ last_event: "bounced" }));
  await box.wake();
  assert.equal(box.values.get(`pending:mlb/${ID}`).state, "attention");
  assert.equal((await (await box.outbox.readStatus()).json()).ok, false);
});

test("abuse limits new submissions but never prevent a saved report's retry", async () => {
  const box = createOutbox();
  for (let index = 0; index < 5; index += 1)
    assert.equal(
      (await box.submit({ ...SUBMISSION, id: `${ID.slice(0, -1)}${index}` })).status,
      202,
    );
  assert.equal((await box.submit()).status, 429);
  assert.equal((await box.submit({ ...SUBMISSION, id: `${ID.slice(0, -1)}0` })).status, 200);
  box.clock.now += 60 * 60 * 1000;
  assert.equal((await box.submit()).status, 202);
});

test("a full queue rejects new reports and an hour-old report makes health fail", async () => {
  const box = createOutbox();
  for (let index = 0; index < 100; index += 1)
    box.values.set(`pending:${index}`, { app: "mlb", createdAt: box.clock.now, state: "queued" });
  assert.equal((await box.submit()).status, 429);
  assert.equal((await (await box.outbox.readStatus()).json()).ok, true);
  box.clock.now += 60 * 60 * 1000 + 1;
  assert.equal((await (await box.outbox.readStatus()).json()).ok, false);
});
