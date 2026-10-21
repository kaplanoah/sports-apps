// The accounts the apps share. An account holds only a random id, its passkeys, keyed hashes of
// its emails, and each app's choices: never a name or a plain email.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";
import { mergeChoices } from "./choices.js";
import { hashEmail } from "./email-hash.js";

export const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const RELYING_PARTY_NAME = "Sports Apps";

/**
 * @typedef {{ id: string, origin: string }} RelyingParty the site a passkey belongs to, as the
 * app's page is served
 * @typedef {{ publicKey: string, counter: number, transports?: string[] }} Passkey
 * @typedef {{
 *   passkeys: Record<string, Passkey>,
 *   emails: string[],
 *   choices: Record<string, import("./choices.js").AppChoices>,
 * }} Account
 * @typedef {{ purpose: "register" | "sign-in", expiresAt: number, accountId?: string,
 *   emailHash?: string, isNew?: boolean }} Challenge
 * @typedef {{
 *   get: (key: string) => Promise<any>,
 *   put: (entries: Record<string, unknown>) => Promise<void>,
 *   delete: (keys: string[]) => Promise<number>,
 *   list: (options: { prefix: string }) => Promise<Map<string, any>>,
 *   getAlarm: () => Promise<number | null>,
 *   setAlarm: (at: number) => Promise<void>,
 * }} AccountStorage the parts of a Durable Object's storage the accounts use
 */

const accountKey = (accountId) => `account/${accountId}`;
const passkeyKey = (credentialId) => `passkey/${credentialId}`;
const emailKey = (emailHash) => `email/${emailHash}`;
const challengeKey = (challenge) => `challenge/${challenge}`;

const createAccountId = () => isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(16)));

/** @param {unknown} response */
function readChallenge(response) {
  try {
    // @ts-ignore a response is whatever the page sent, checked here
    return decodeClientDataJSON(response.response.clientDataJSON).challenge;
  } catch {
    return null;
  }
}

/** @param {Account} account */
const listPasskeyKeys = (account) => Object.keys(account.passkeys).map(passkeyKey);

/**
 * @param {{ storage: AccountStorage, emailSecret: string, now?: () => number }} options
 */
export function createAccounts({ storage, emailSecret, now = Date.now }) {
  /** @param {string} accountId @returns {Promise<Account | undefined>} */
  const readAccount = (accountId) => storage.get(accountKey(accountId));

  /** @param {string} challenge @param {Omit<Challenge, "expiresAt">} record */
  async function keepChallenge(challenge, record) {
    const expiresAt = now() + CHALLENGE_LIFETIME_MS;
    await storage.put({ [challengeKey(challenge)]: { ...record, expiresAt } });
    if ((await storage.getAlarm()) === null) await storage.setAlarm(expiresAt);
  }

  // Each challenge answers once, so a response replayed later finds none.
  /** @param {unknown} response @param {Challenge["purpose"]} purpose */
  async function takeChallenge(response, purpose) {
    const challenge = readChallenge(response);
    if (!challenge) return null;
    const key = challengeKey(challenge);
    /** @type {Challenge | undefined} */
    const record = await storage.get(key);
    if (!record) return null;
    await storage.delete([key]);
    if (record.purpose !== purpose || record.expiresAt <= now()) return null;
    return { challenge, record };
  }

  /**
   * A new account's first passkey, under an email no account has, or another passkey for an
   * account, under one of its emails.
   * @param {{ relyingParty: RelyingParty, email: string, accountId?: string }} request
   */
  async function startRegistration({ relyingParty, email, accountId }) {
    if (!email?.trim()) return { problem: "needs-email" };
    const emailHash = await hashEmail(email, emailSecret);
    const account = accountId && (await readAccount(accountId));
    if (accountId && !account) return { problem: "no-account" };
    if (account && !account.emails.includes(emailHash)) return { problem: "not-account-email" };
    if (!account && (await storage.get(emailKey(emailHash)))) return { problem: "email-taken" };
    const id = accountId ?? createAccountId();
    const options = await generateRegistrationOptions({
      rpName: RELYING_PARTY_NAME,
      rpID: relyingParty.id,
      userName: email.trim(),
      userID: isoBase64URL.toBuffer(id),
      attestationType: "none",
      excludeCredentials: Object.entries(account?.passkeys ?? {}).map(([id, passkey]) => ({
        id,
        // @ts-ignore transports are as the browser named them
        transports: passkey.transports,
      })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    await keepChallenge(options.challenge, {
      purpose: "register",
      accountId: id,
      emailHash,
      isNew: !account,
    });
    return { options };
  }

  /** @param {{ relyingParty: RelyingParty, response: unknown }} request */
  async function finishRegistration({ relyingParty, response }) {
    const taken = await takeChallenge(response, "register");
    if (!taken) return { problem: "no-challenge" };
    const { challenge, record } = taken;
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        // @ts-ignore the library checks the response's shape
        response,
        expectedChallenge: challenge,
        expectedOrigin: relyingParty.origin,
        expectedRPID: relyingParty.id,
        requireUserVerification: true,
      });
    } catch {
      return { problem: "not-verified" };
    }
    if (!verification.verified) return { problem: "not-verified" };
    const { credential } = verification.registrationInfo;
    const passkey = {
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      ...(credential.transports && { transports: credential.transports }),
    };
    const { accountId, emailHash, isNew } = record;
    if (await storage.get(passkeyKey(credential.id))) return { problem: "passkey-taken" };
    if (isNew) {
      if (await storage.get(emailKey(emailHash))) return { problem: "email-taken" };
      /** @type {Account} */
      const account = { passkeys: { [credential.id]: passkey }, emails: [emailHash], choices: {} };
      await storage.put({
        [accountKey(accountId)]: account,
        [emailKey(emailHash)]: accountId,
        [passkeyKey(credential.id)]: accountId,
      });
      return { accountId };
    }
    const account = await readAccount(accountId);
    if (!account) return { problem: "no-account" };
    await storage.put({
      [accountKey(accountId)]: {
        ...account,
        passkeys: { ...account.passkeys, [credential.id]: passkey },
      },
      [passkeyKey(credential.id)]: accountId,
    });
    return { accountId };
  }

  // Any passkey the phone holds for the site may answer, so sign-in names no account.
  /** @param {{ relyingParty: RelyingParty }} request */
  async function startSignIn({ relyingParty }) {
    const options = await generateAuthenticationOptions({
      rpID: relyingParty.id,
      userVerification: "required",
    });
    await keepChallenge(options.challenge, { purpose: "sign-in" });
    return { options };
  }

  /** @param {{ relyingParty: RelyingParty, response: unknown }} request */
  async function finishSignIn({ relyingParty, response }) {
    const taken = await takeChallenge(response, "sign-in");
    if (!taken) return { problem: "no-challenge" };
    // @ts-ignore a response is whatever the page sent
    const credentialId = typeof response.id === "string" ? response.id : null;
    const accountId = credentialId && (await storage.get(passkeyKey(credentialId)));
    const account = accountId && (await readAccount(accountId));
    const passkey = account?.passkeys[credentialId];
    if (!passkey) return { problem: "no-passkey" };
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        // @ts-ignore the library checks the response's shape
        response,
        expectedChallenge: taken.challenge,
        expectedOrigin: relyingParty.origin,
        expectedRPID: relyingParty.id,
        requireUserVerification: true,
        credential: {
          id: credentialId,
          publicKey: isoBase64URL.toBuffer(passkey.publicKey),
          counter: passkey.counter,
        },
      });
    } catch {
      return { problem: "not-verified" };
    }
    if (!verification.verified) return { problem: "not-verified" };
    const counter = verification.authenticationInfo.newCounter;
    await storage.put({
      [accountKey(accountId)]: {
        ...account,
        passkeys: { ...account.passkeys, [credentialId]: { ...passkey, counter } },
      },
    });
    return { accountId };
  }

  /** @param {{ accountId: string, app: string }} request */
  async function readChoices({ accountId, app }) {
    const account = await readAccount(accountId);
    if (!account) return { problem: "no-account" };
    return { choices: account.choices[app] ?? {} };
  }

  /** @param {{ accountId: string, app: string, choices: Record<string, unknown> }} request */
  async function saveChoices({ accountId, app, choices }) {
    const account = await readAccount(accountId);
    if (!account) return { problem: "no-account" };
    const merged = mergeChoices(account.choices[app] ?? {}, choices ?? {});
    await storage.put({
      [accountKey(accountId)]: { ...account, choices: { ...account.choices, [app]: merged } },
    });
    return { choices: merged };
  }

  // A passkey removed is gone from the phone's list only once the phone forgets it, so the last
  // one stays, or the account would have no way back in.
  /** @param {{ accountId: string, credentialId: string }} request */
  async function removePasskey({ accountId, credentialId }) {
    const account = await readAccount(accountId);
    if (!account) return { problem: "no-account" };
    if (!account.passkeys[credentialId]) return { problem: "no-passkey" };
    if (Object.keys(account.passkeys).length === 1) return { problem: "last-passkey" };
    const { [credentialId]: _removed, ...passkeys } = account.passkeys;
    await storage.put({ [accountKey(accountId)]: { ...account, passkeys } });
    await storage.delete([passkeyKey(credentialId)]);
    return { removed: credentialId };
  }

  /** @param {{ accountId: string }} request */
  async function deleteAccount({ accountId }) {
    const account = await readAccount(accountId);
    if (!account) return { problem: "no-account" };
    await storage.delete([
      accountKey(accountId),
      ...listPasskeyKeys(account),
      ...account.emails.map(emailKey),
    ]);
    return { deleted: accountId };
  }

  // Challenges a phone never answered go once they expire, and the alarm comes back for the next.
  async function sweepChallenges() {
    const challenges = await storage.list({ prefix: "challenge/" });
    const expired = [...challenges].filter(([, record]) => record.expiresAt <= now());
    if (expired.length) await storage.delete(expired.map(([key]) => key));
    const next = Math.min(
      ...[...challenges.values()].map(({ expiresAt }) => expiresAt).filter((at) => at > now()),
    );
    if (Number.isFinite(next)) await storage.setAlarm(next);
  }

  return {
    startRegistration,
    finishRegistration,
    startSignIn,
    finishSignIn,
    readChoices,
    saveChoices,
    removePasskey,
    deleteAccount,
    sweepChallenges,
  };
}
