import assert from "node:assert/strict";
import { test } from "node:test";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import { CHALLENGE_LIFETIME_MS, createAccounts } from "../worker/src/accounts.js";
import { hashEmail } from "../worker/src/email-hash.js";
import { readServiceHealth } from "../worker/src/health.js";
import { createFakeAuthenticator } from "./fake-authenticator.js";

const RP_ID = "example.test";
const ORIGIN = "https://example.test";
const EMAIL = "Fan@Example.test";

function createTestAccounts(secrets = {}) {
  const context = createDurableObjectContext();
  const clock = { now: Date.UTC(2026, 9, 21, 12) };
  const counts = {};
  const storage = new Proxy(context.ctx.storage, {
    get:
      (target, name) =>
      (...args) => {
        counts[name] = (counts[name] ?? 0) + 1;
        return target[name](...args);
      },
  });
  const accounts = createAccounts({
    storage,
    secrets: { EMAIL_KEY: "test-secret", RP_ID, ...secrets },
    now: () => clock.now,
  });
  return { accounts, context, clock, counts };
}

const createPasskey = () => createFakeAuthenticator({ rpId: RP_ID, origin: ORIGIN });

/** @param {ReturnType<typeof createAccounts>} accounts */
async function registerAccount(accounts, passkey, email = EMAIL) {
  const { options } = await accounts.startRegistration({ email });
  return accounts.finishRegistration({ origin: ORIGIN, response: await passkey.register(options) });
}

/** @param {ReturnType<typeof createAccounts>} accounts */
async function signIn(accounts, passkey) {
  const { options } = await accounts.startSignIn();
  return accounts.finishSignIn({ origin: ORIGIN, response: await passkey.signIn(options) });
}

test("a passkey registers an account and signs back in to it", async () => {
  const { accounts, context } = createTestAccounts();
  const passkey = await createPasskey();
  const { accountId } = await registerAccount(accounts, passkey);
  assert.match(accountId, /^[\w-]{22}$/);
  assert.deepEqual(await signIn(accounts, passkey), { accountId });
  const account = context.stored.get(`account/${accountId}`);
  assert.equal(account.passkeys[passkey.id].counter, 2);
  assert.equal(context.stored.get(`passkey/${passkey.id}`), accountId);
});

test("the store never holds an email, only its keyed hash", async () => {
  const { accounts, context } = createTestAccounts();
  await registerAccount(accounts, await createPasskey());
  const kept = JSON.stringify([...context.stored]).toLowerCase();
  assert.ok(!kept.includes(EMAIL.toLowerCase()));
  assert.ok(!kept.includes("fan"));
  assert.ok(context.stored.has(`email/${await hashEmail(EMAIL, "test-secret")}`));
});

test("an email hashes the same however it's typed, and differently under another key", async () => {
  const hash = await hashEmail("fan@example.test", "test-secret");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await hashEmail("  FAN@Example.TEST ", "test-secret"), hash);
  assert.notEqual(await hashEmail("fan@example.test", "other-secret"), hash);
});

test("an email in use can't start another account", async () => {
  const { accounts } = createTestAccounts();
  await registerAccount(accounts, await createPasskey());
  assert.deepEqual(await accounts.startRegistration({ email: " fan@example.TEST" }), {
    problem: "email-taken",
  });
  assert.deepEqual(await accounts.startRegistration({ email: " " }), {
    problem: "needs-email",
  });
});

test("an email claimed while another registration was open isn't claimed twice", async () => {
  const { accounts } = createTestAccounts();
  const first = await accounts.startRegistration({ email: EMAIL });
  const second = await accounts.startRegistration({ email: EMAIL });
  const firstPasskey = await createPasskey();
  const secondPasskey = await createPasskey();
  await accounts.finishRegistration({
    origin: ORIGIN,
    response: await firstPasskey.register(first.options),
  });
  assert.deepEqual(
    await accounts.finishRegistration({
      origin: ORIGIN,
      response: await secondPasskey.register(second.options),
    }),
    { problem: "email-taken" },
  );
});

test("an account adds a passkey under one of its emails, and either signs in", async () => {
  const { accounts } = createTestAccounts();
  const first = await createPasskey();
  const { accountId } = await registerAccount(accounts, first);
  assert.deepEqual(await accounts.startRegistration({ email: "other@example.test", accountId }), {
    problem: "not-account-email",
  });
  assert.deepEqual(await accounts.startRegistration({ email: EMAIL, accountId: "missing" }), {
    problem: "no-account",
  });
  const { options } = await accounts.startRegistration({ email: EMAIL, accountId });
  assert.deepEqual(
    options.excludeCredentials.map(({ id }) => id),
    [first.id],
  );
  const second = await createPasskey();
  assert.deepEqual(
    await accounts.finishRegistration({ origin: ORIGIN, response: await second.register(options) }),
    { accountId },
  );
  assert.deepEqual(await signIn(accounts, first), { accountId });
  assert.deepEqual(await signIn(accounts, second), { accountId });
});

test("a challenge answers once, for its own purpose, and only before it expires", async () => {
  const { accounts, clock } = createTestAccounts();
  const passkey = await createPasskey();
  await registerAccount(accounts, passkey);
  const { options } = await accounts.startSignIn();
  const response = await passkey.signIn(options);
  assert.ok((await accounts.finishSignIn({ origin: ORIGIN, response })).accountId);
  assert.deepEqual(await accounts.finishSignIn({ origin: ORIGIN, response }), {
    problem: "no-challenge",
  });

  const late = await accounts.startSignIn();
  clock.now += CHALLENGE_LIFETIME_MS;
  assert.deepEqual(
    await accounts.finishSignIn({ origin: ORIGIN, response: await passkey.signIn(late.options) }),
    { problem: "no-challenge" },
  );

  const signInChallenge = await accounts.startSignIn();
  assert.deepEqual(
    await accounts.finishRegistration({
      origin: ORIGIN,
      response: await (
        await createPasskey()
      ).register({
        ...signInChallenge.options,
        user: { id: "AAAA" },
      }),
    }),
    { problem: "no-challenge" },
  );
  assert.deepEqual(await accounts.finishSignIn({ origin: ORIGIN, response: { id: "x" } }), {
    problem: "no-challenge",
  });
});

test("a response from another site or an unknown passkey doesn't sign in", async () => {
  const { accounts } = createTestAccounts();
  const passkey = await createPasskey();
  await registerAccount(accounts, passkey);
  const elsewhere = await createFakeAuthenticator({
    rpId: RP_ID,
    origin: "https://elsewhere.test",
  });
  const registration = await accounts.startRegistration({ email: "new@example.test" });
  assert.deepEqual(
    await accounts.finishRegistration({
      origin: ORIGIN,
      response: await elsewhere.register(registration.options),
    }),
    { problem: "not-verified" },
  );
  assert.deepEqual(await signIn(accounts, elsewhere), { problem: "no-passkey" });
});

test("a passkey made on one app's page signs in on another's, under the one site", async () => {
  const { accounts } = createTestAccounts();
  const passkey = await createPasskey();
  const { accountId } = await registerAccount(accounts, passkey);
  const otherApp = "https://other.example.test";
  const { options } = await accounts.startSignIn();
  assert.equal(options.rpId, RP_ID);
  assert.deepEqual(
    await accounts.finishSignIn({
      origin: otherApp,
      response: await passkey.signIn(options, { origin: otherApp }),
    }),
    { accountId },
  );
  const again = await accounts.startSignIn();
  assert.deepEqual(
    await accounts.finishSignIn({
      origin: ORIGIN,
      response: await passkey.signIn(again.options, { origin: otherApp }),
    }),
    { problem: "not-verified" },
  );
});

test("without its email key or its site, registration and sign-in refuse and store nothing", async () => {
  const missing = [
    [{ EMAIL_KEY: undefined }, { problem: "no-email-key" }],
    [{ RP_ID: undefined }, { problem: "no-relying-party" }],
  ];
  for (const [secrets, refused] of missing) {
    const { accounts, context } = createTestAccounts(secrets);
    assert.deepEqual(await accounts.startRegistration({ email: EMAIL }), refused);
    assert.deepEqual(await accounts.finishRegistration({ origin: ORIGIN, response: {} }), refused);
    assert.deepEqual(await accounts.startSignIn(), refused);
    assert.deepEqual(await accounts.finishSignIn({ origin: ORIGIN, response: {} }), refused);
    assert.equal(context.stored.size, 0);
  }
});

test("the service's health is ok exactly when registration and sign-in don't refuse", async () => {
  const cases = [{}, { EMAIL_KEY: undefined }, { RP_ID: undefined }, { EMAIL_KEY: "", RP_ID: "" }];
  for (const secrets of cases) {
    const { accounts } = createTestAccounts(secrets);
    const health = await readServiceHealth({
      env: { EMAIL_KEY: "test-secret", RP_ID, ...secrets },
      isStoreAnswering: async () => true,
    });
    const { problem } = await accounts.startSignIn();
    assert.equal(health.ok, !problem, JSON.stringify(secrets));
  }
});

test("the last passkey stays, and a removed one no longer signs in", async () => {
  const { accounts, context } = createTestAccounts();
  const first = await createPasskey();
  const { accountId } = await registerAccount(accounts, first);
  assert.deepEqual(await accounts.removePasskey({ accountId, credentialId: first.id }), {
    problem: "last-passkey",
  });
  const second = await createPasskey();
  const { options } = await accounts.startRegistration({ email: EMAIL, accountId });
  await accounts.finishRegistration({ origin: ORIGIN, response: await second.register(options) });
  assert.deepEqual(await accounts.removePasskey({ accountId, credentialId: first.id }), {
    removed: first.id,
  });
  assert.deepEqual(await accounts.removePasskey({ accountId, credentialId: first.id }), {
    problem: "no-passkey",
  });
  assert.ok(!context.stored.has(`passkey/${first.id}`));
  assert.deepEqual(await signIn(accounts, first), { problem: "no-passkey" });
  assert.deepEqual(await signIn(accounts, second), { accountId });
});

test("deleting an account leaves nothing of it, and frees its email", async () => {
  const { accounts, context } = createTestAccounts();
  const passkey = await createPasskey();
  const { accountId } = await registerAccount(accounts, passkey);
  assert.deepEqual(await accounts.deleteAccount({ accountId }), { deleted: accountId });
  assert.deepEqual(
    [...context.stored.keys()].filter((key) => !key.startsWith("challenge/")),
    [],
  );
  assert.deepEqual(await accounts.deleteAccount({ accountId }), { problem: "no-account" });
  assert.deepEqual(await signIn(accounts, passkey), { problem: "no-passkey" });
  assert.ok((await registerAccount(accounts, await createPasskey())).accountId);
});

test("each app's choices stay apart, and the one made last wins", async () => {
  const { accounts } = createTestAccounts();
  const { accountId } = await registerAccount(accounts, await createPasskey());
  await accounts.saveChoices({
    accountId,
    app: "mlb",
    choices: { ranking: { value: "wins", writtenAt: 20 }, theme: { value: "dark", writtenAt: 5 } },
  });
  const saved = await accounts.saveChoices({
    accountId,
    app: "mlb",
    choices: {
      ranking: { value: "runs", writtenAt: 10 },
      theme: { value: "light", writtenAt: 30 },
      untimed: { value: "no time" },
      textTime: { value: "a time as text", writtenAt: "99" },
    },
  });
  const expected = {
    ranking: { value: "wins", writtenAt: 20 },
    theme: { value: "light", writtenAt: 30 },
  };
  assert.deepEqual(saved, { choices: expected });
  assert.deepEqual(await accounts.readChoices({ accountId, app: "mlb" }), { choices: expected });
  assert.deepEqual(await accounts.readChoices({ accountId, app: "wnba" }), { choices: {} });
  assert.deepEqual(await accounts.readChoices({ accountId: "missing", app: "mlb" }), {
    problem: "no-account",
  });
  assert.deepEqual(await accounts.saveChoices({ accountId: "missing", app: "mlb", choices: {} }), {
    problem: "no-account",
  });
});

test("the alarm sweeps challenges never answered and comes back for the next", async () => {
  const { accounts, context, clock } = createTestAccounts();
  await accounts.startSignIn();
  const firstExpiry = clock.now + CHALLENGE_LIFETIME_MS;
  assert.equal(context.alarm.at, firstExpiry);
  clock.now += 60_000;
  await accounts.startSignIn();
  clock.now = firstExpiry;
  await accounts.sweepChallenges();
  assert.equal([...context.stored.keys()].length, 1);
  assert.equal(context.alarm.at, firstExpiry + 60_000);
});

test("signing in reads and writes the store only as often as it must", async () => {
  const { accounts, counts } = createTestAccounts();
  const passkey = await createPasskey();
  await registerAccount(accounts, passkey);
  for (const name of Object.keys(counts)) delete counts[name];
  await signIn(accounts, passkey);
  assert.deepEqual(counts, { put: 2, getAlarm: 1, get: 3, delete: 1 });
});
