import assert from "node:assert/strict";
import { test } from "node:test";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import { CHALLENGE_LIFETIME_MS, createAccounts } from "../worker/src/accounts.js";
import { hashEmail } from "../worker/src/email-hash.js";
import { createFakeAuthenticator } from "./fake-authenticator.js";

const relyingParty = { id: "example.test", origin: "https://example.test" };
const EMAIL = "Fan@Example.test";

function createTestAccounts() {
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
  const accounts = createAccounts({ storage, emailSecret: "test-secret", now: () => clock.now });
  return { accounts, context, clock, counts };
}

const createPasskey = () =>
  createFakeAuthenticator({ rpId: relyingParty.id, origin: relyingParty.origin });

/** @param {ReturnType<typeof createAccounts>} accounts */
async function registerAccount(accounts, passkey, email = EMAIL) {
  const { options } = await accounts.startRegistration({ relyingParty, email });
  return accounts.finishRegistration({ relyingParty, response: await passkey.register(options) });
}

/** @param {ReturnType<typeof createAccounts>} accounts */
async function signIn(accounts, passkey) {
  const { options } = await accounts.startSignIn({ relyingParty });
  return accounts.finishSignIn({ relyingParty, response: await passkey.signIn(options) });
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
  assert.deepEqual(await accounts.startRegistration({ relyingParty, email: " fan@example.TEST" }), {
    problem: "email-taken",
  });
  assert.deepEqual(await accounts.startRegistration({ relyingParty, email: " " }), {
    problem: "needs-email",
  });
});

test("an email claimed while another registration was open isn't claimed twice", async () => {
  const { accounts } = createTestAccounts();
  const first = await accounts.startRegistration({ relyingParty, email: EMAIL });
  const second = await accounts.startRegistration({ relyingParty, email: EMAIL });
  const firstPasskey = await createPasskey();
  const secondPasskey = await createPasskey();
  await accounts.finishRegistration({
    relyingParty,
    response: await firstPasskey.register(first.options),
  });
  assert.deepEqual(
    await accounts.finishRegistration({
      relyingParty,
      response: await secondPasskey.register(second.options),
    }),
    { problem: "email-taken" },
  );
});

test("an account adds a passkey under one of its emails, and either signs in", async () => {
  const { accounts } = createTestAccounts();
  const first = await createPasskey();
  const { accountId } = await registerAccount(accounts, first);
  assert.deepEqual(
    await accounts.startRegistration({ relyingParty, email: "other@example.test", accountId }),
    { problem: "not-account-email" },
  );
  assert.deepEqual(
    await accounts.startRegistration({ relyingParty, email: EMAIL, accountId: "missing" }),
    { problem: "no-account" },
  );
  const { options } = await accounts.startRegistration({ relyingParty, email: EMAIL, accountId });
  assert.deepEqual(
    options.excludeCredentials.map(({ id }) => id),
    [first.id],
  );
  const second = await createPasskey();
  assert.deepEqual(
    await accounts.finishRegistration({ relyingParty, response: await second.register(options) }),
    { accountId },
  );
  assert.deepEqual(await signIn(accounts, first), { accountId });
  assert.deepEqual(await signIn(accounts, second), { accountId });
});

test("a challenge answers once, for its own purpose, and only before it expires", async () => {
  const { accounts, clock } = createTestAccounts();
  const passkey = await createPasskey();
  await registerAccount(accounts, passkey);
  const { options } = await accounts.startSignIn({ relyingParty });
  const response = await passkey.signIn(options);
  assert.ok((await accounts.finishSignIn({ relyingParty, response })).accountId);
  assert.deepEqual(await accounts.finishSignIn({ relyingParty, response }), {
    problem: "no-challenge",
  });

  const late = await accounts.startSignIn({ relyingParty });
  clock.now += CHALLENGE_LIFETIME_MS;
  assert.deepEqual(
    await accounts.finishSignIn({ relyingParty, response: await passkey.signIn(late.options) }),
    { problem: "no-challenge" },
  );

  const signInChallenge = await accounts.startSignIn({ relyingParty });
  assert.deepEqual(
    await accounts.finishRegistration({
      relyingParty,
      response: await (
        await createPasskey()
      ).register({
        ...signInChallenge.options,
        user: { id: "AAAA" },
      }),
    }),
    { problem: "no-challenge" },
  );
  assert.deepEqual(await accounts.finishSignIn({ relyingParty, response: { id: "x" } }), {
    problem: "no-challenge",
  });
});

test("a response from another site or an unknown passkey doesn't sign in", async () => {
  const { accounts } = createTestAccounts();
  const passkey = await createPasskey();
  await registerAccount(accounts, passkey);
  const elsewhere = await createFakeAuthenticator({
    rpId: relyingParty.id,
    origin: "https://elsewhere.test",
  });
  const registration = await accounts.startRegistration({
    relyingParty,
    email: "new@example.test",
  });
  assert.deepEqual(
    await accounts.finishRegistration({
      relyingParty,
      response: await elsewhere.register(registration.options),
    }),
    { problem: "not-verified" },
  );
  assert.deepEqual(await signIn(accounts, elsewhere), { problem: "no-passkey" });
});

test("the last passkey stays, and a removed one no longer signs in", async () => {
  const { accounts, context } = createTestAccounts();
  const first = await createPasskey();
  const { accountId } = await registerAccount(accounts, first);
  assert.deepEqual(await accounts.removePasskey({ accountId, credentialId: first.id }), {
    problem: "last-passkey",
  });
  const second = await createPasskey();
  const { options } = await accounts.startRegistration({ relyingParty, email: EMAIL, accountId });
  await accounts.finishRegistration({ relyingParty, response: await second.register(options) });
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
  await accounts.startSignIn({ relyingParty });
  const firstExpiry = clock.now + CHALLENGE_LIFETIME_MS;
  assert.equal(context.alarm.at, firstExpiry);
  clock.now += 60_000;
  await accounts.startSignIn({ relyingParty });
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
