import test from "node:test";
import assert from "node:assert/strict";
import { createAdmissionController } from "../worker/codex-rate-controller.mjs";

const policy = {
  tokens: 100,
  requests: 10,
  windowMs: 60000,
  maxWaitMs: 120000,
  feedbackHeadroom: 0,
};

test("authenticated prior cooldown and provider pressure delay admission before any request is sent", async () => {
  let time = 0;
  const waits = [];
  const control = createAdmissionController(policy, {
    now: () => time,
    wait: async (ms) => {
      waits.push(ms);
      time += ms;
    },
    notBefore: 5000,
  });
  const ticket = await control.reserve(10);
  assert.equal(time, 5000);
  control.observeHeaders(
    new Headers({ "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "2s" }),
  );
  control.settle(ticket, 10);
  const second = await control.reserve(10);
  assert.equal(time, 7000);
  assert.deepEqual(waits, [5000, 2000]);
  control.settle(second, null);
  assert.equal(control.readSnapshot().local.events.at(-1).observed, null);
});

test("malformed feedback preserves the accepted response but blocks the next request", async () => {
  const control = createAdmissionController(policy);
  const ticket = await control.reserve(10);
  control.observeHeaders(new Headers({ "x-ratelimit-remaining-tokens": "broken" }));
  control.settle(ticket, 12);
  assert.equal(control.readSnapshot().local.events[0].observed, 12);
  assert.equal(control.readSnapshot().feedbackFailed, true);
  await assert.rejects(control.reserve(1), /feedback/);
});

test("observed overshoot reduces remaining provider allowance without losing the actual counter", async () => {
  const control = createAdmissionController(policy, { now: () => 0 });
  const ticket = await control.reserve(10);
  control.observeHeaders(
    new Headers({ "x-ratelimit-remaining-tokens": "50", "x-ratelimit-reset-tokens": "1s" }),
  );
  control.settle(ticket, 30);
  assert.equal(control.readSnapshot().provider.tokens.remaining, 30);
  assert.equal(control.readSnapshot().local.events[0].observed, 30);
});

test("provider deadlines beyond admission budget block before another send", async () => {
  const control = createAdmissionController(policy, { now: () => 0 });
  control.observeHeaders(
    new Headers({ "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "1h" }),
  );
  await assert.rejects(control.reserve(1), /wait exhausted/);
  assert.equal(control.readSnapshot().local.events[0].observed, null);
});
