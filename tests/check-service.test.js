import test from "node:test";
import assert from "node:assert/strict";
import { checkService } from "../worker/check-service.mjs";

const APPS = [
  { app: "mlb", url: "https://mlb-app.example-subdomain.workers.dev/" },
  { app: "wnba", url: "https://wnba-app.example-subdomain.workers.dev/" },
];
const COMMIT = "2".repeat(40);

/**
 * A fetch that answers each app's health with what that app's answers say, one per attempt, in
 * order, repeating the last.
 * @param {Record<string, (object | Error)[]>} answers each app's bodies, or an Error to throw
 */
function createFakeApps(answers) {
  const asked = [];
  const attemptsByApp = {};
  /** @type {typeof fetch} */
  const fetchImpl = async (input) => {
    const url = String(input);
    asked.push(url);
    const app = APPS.find((entry) => url.startsWith(entry.url)).app;
    const attempt = attemptsByApp[app] ?? 0;
    attemptsByApp[app] = attempt + 1;
    const answer = answers[app][Math.min(attempt, answers[app].length - 1)];
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer));
  };
  return { fetchImpl, asked };
}

/**
 * @param {ReturnType<typeof createFakeApps>} fake
 * @param {{ attempts?: number, commit?: string }} [options]
 */
function check({ fetchImpl }, { attempts = 3, commit = COMMIT } = {}) {
  const pauses = [];
  const result = checkService({
    service: "accounts",
    apps: APPS,
    commit,
    attempts,
    pauseMs: 60000,
    pause: async (milliseconds) => {
      pauses.push(milliseconds);
    },
    fetchImpl,
  });
  return { result, pauses };
}

const reporting = (report) => ({ ok: true, services: { accounts: report } });
const RELEASED = reporting({ ok: true, release: "2222222" });

test("a service answers once every app that reports it says it's ok at the commit, reading each app's health", async () => {
  const fake = createFakeApps({ mlb: [RELEASED], wnba: [RELEASED] });
  const { result, pauses } = check(fake);
  assert.deepEqual(await result, { status: "answering" });
  assert.deepEqual(fake.asked, [
    "https://mlb-app.example-subdomain.workers.dev/health",
    "https://wnba-app.example-subdomain.workers.dev/health",
  ]);
  assert.deepEqual(pauses, []);
});

test("each attempt after the first waits, and a later one can find the service answering", async () => {
  const old = reporting({ ok: true, release: "1111111" });
  const fake = createFakeApps({ mlb: [old, RELEASED], wnba: [RELEASED] });
  const { result, pauses } = check(fake);
  assert.deepEqual(await result, { status: "answering" });
  assert.deepEqual(pauses, [60000]);
});

test("a service still wrong after every attempt is unanswered, with each app's problem from the last", async () => {
  const fake = createFakeApps({
    mlb: [reporting({ ok: false, release: null, problem: "no RP_ID secret" })],
    wnba: [reporting({ ok: true, release: null })],
  });
  const { result, pauses } = check(fake);
  assert.deepEqual(await result, {
    status: "unanswered",
    reason:
      "mlb finds accounts not ok: no RP_ID secret; wnba reaches accounts at no known commit, not 2222222",
  });
  assert.equal(pauses.length, 2);
});

test("a service that answers but needs attention answers at once, naming each different need once", async () => {
  const needing = (attention) => reporting({ ok: true, release: "2222222", attention });
  const fake = createFakeApps({
    mlb: [needing("Contact delivery needs attention")],
    wnba: [needing("Contact delivery needs attention")],
  });
  const { result, pauses } = check(fake);
  assert.deepEqual(await result, {
    status: "answering",
    attention: "Contact delivery needs attention",
  });
  assert.deepEqual(pauses, []);

  const mixed = createFakeApps({ mlb: [needing("one")], wnba: [needing("two")] });
  assert.deepEqual(await check(mixed).result, { status: "answering", attention: "one; two" });
});

test("with no commit to match, any release that's ok answers", async () => {
  const fake = createFakeApps({
    mlb: [reporting({ ok: true, release: "1111111" })],
    wnba: [reporting({ ok: true, release: null })],
  });
  assert.deepEqual(await check(fake, { commit: "" }).result, { status: "answering" });
});

test("an app that binds no service says nothing of it", async () => {
  const fake = createFakeApps({ mlb: [{ ok: true }], wnba: [{ ok: true }] });
  const { result, pauses } = check(fake);
  assert.deepEqual(await result, { status: "unchecked", reason: "no app reaches accounts yet" });
  assert.deepEqual(pauses, []);

  const partly = createFakeApps({ mlb: [{ ok: true }], wnba: [RELEASED] });
  assert.deepEqual(await check(partly).result, { status: "answering" });
});

test("an app whose health doesn't answer is asked again, and is a problem until it answers", async () => {
  const late = createFakeApps({ mlb: [new Error("unreachable"), RELEASED], wnba: [{ ok: true }] });
  const { result, pauses } = check(late);
  assert.deepEqual(await result, { status: "answering" });
  assert.deepEqual(pauses, [60000]);

  const silent = createFakeApps({ mlb: [new Error("timed out")], wnba: [new Error("timed out")] });
  assert.deepEqual(await check(silent).result, {
    status: "unanswered",
    reason: "mlb's health doesn't answer; wnba's health doesn't answer",
  });
});

test("once an attempt finds the service wrong, a later one that times out or finds it unbound never passes", async () => {
  const old = reporting({ ok: true, release: "1111111" });
  const timedOut = createFakeApps({ mlb: [old, new Error("timed out")], wnba: [{ ok: true }] });
  assert.deepEqual(await check(timedOut, { attempts: 2 }).result, {
    status: "unanswered",
    reason: "mlb's health doesn't answer",
  });

  const unbound = createFakeApps({ mlb: [old, { ok: true }], wnba: [{ ok: true }] });
  assert.deepEqual(await check(unbound, { attempts: 2 }).result, {
    status: "unanswered",
    reason: "mlb reaches accounts at 1111111, not 2222222",
  });
});

test("an app whose own health fails still reports the service it reaches", async () => {
  const fake = createFakeApps({
    mlb: [{ ok: false, services: { accounts: { ok: true, release: "2222222" } } }],
    wnba: [{ ok: false }],
  });
  assert.deepEqual(await check(fake).result, { status: "answering" });
});
