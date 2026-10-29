import test from "node:test";
import assert from "node:assert/strict";
import { createAdmissionController } from "../worker/codex-rate-controller.mjs";
import { createRateClock } from "./codex-rate-clock.js";

const policy = {
  tokens: 100,
  requests: 10,
  windowMs: 60000,
  maxWaitMs: 120000,
  feedbackHeadroom: 0,
};

test("provider waiters obey cooldown learned after they started waiting", async () => {
  const clock = createRateClock();
  const control = createAdmissionController(policy, clock);
  control.observeHeaders(
    new Headers({ "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "2s" }),
  );
  let admittedAt;
  const pending = control.reserve(10).then((ticket) => {
    admittedAt = clock.now();
    control.settle(ticket, 10);
  });
  await clock.advance(1000);
  control.defer(11000);
  await clock.advance(2000);
  const beforeCooldown = admittedAt;
  await clock.advance(11000);
  await pending;
  assert.equal(beforeCooldown, undefined);
  assert.equal(admittedAt, 11000);
});

test("provider reset cannot release concurrent waiters in a burst", async () => {
  const clock = createRateClock();
  const control = createAdmissionController({ ...policy, spacingMs: 250 }, clock);
  control.observeHeaders(
    new Headers({ "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "2s" }),
  );
  const admitted = [];
  const requests = [1, 2].map(() =>
    control.reserve(10).then((ticket) => {
      admitted.push(clock.now());
      control.settle(ticket, 10);
    }),
  );
  await clock.advance(250);
  await clock.advance(2000);
  const atReset = [...admitted];
  await clock.advance(2250);
  await Promise.all(requests);
  assert.deepEqual(atReset, [2000]);
  assert.deepEqual(admitted, [2000, 2250]);
});

test("authenticated prior cooldown and provider pressure delay admission before any request is sent", async () => {
  const clock = createRateClock();
  const control = createAdmissionController(policy, { ...clock, notBefore: 5000 });
  const first = control.reserve(10);
  await clock.advance(5000);
  const ticket = await first;
  assert.equal(clock.now(), 5000);
  control.observeHeaders(
    new Headers({ "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "2s" }),
  );
  control.settle(ticket, 10);
  const next = control.reserve(10);
  await clock.advance(5000);
  await clock.advance(7000);
  const second = await next;
  assert.equal(clock.now(), 7000);
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
  await assert.rejects(control.reserve(1), /wait budget exhausted/);
  assert.deepEqual(control.readSnapshot().local.events, []);
});
