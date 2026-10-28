// Sends Web Push messages: signed for the push service (RFC 8292, VAPID) and encrypted for the
// browser (RFC 8291). Uses only Web Crypto, which Workers and Node both have.

import { abortAfter } from "./timeout.js";

const RECORD_SIZE = 4096;
const TOKEN_LIFETIME_S = 12 * 60 * 60;
const MESSAGE_TTL_S = 6 * 60 * 60;
// A push service that doesn't answer would otherwise hold up the season's update.
const SEND_TIMEOUT_MS = 10 * 1000;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const ECDH = { name: "ECDH", namedCurve: "P-256" };

const textEncoder = new TextEncoder();

export function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function joinBytes(...parts) {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

// An uncompressed P-256 point: 0x04, then x and y.
const readPublicKey = (jwk) => joinBytes([4], decodeBase64Url(jwk.x), decodeBase64Url(jwk.y));

function describePublicKey(publicKey) {
  return {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(publicKey.slice(1, 33)),
    y: encodeBase64Url(publicKey.slice(33, 65)),
  };
}

export async function createSigningKey() {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  return crypto.subtle.exportKey("jwk", pair.privateKey);
}

export const readApplicationServerKey = (signingKey) => encodeBase64Url(readPublicKey(signingKey));

/**
 * @param {object} options
 * @param {string} options.endpoint the subscription's push service URL
 * @param {JsonWebKey} options.signingKey
 * @param {string} options.subject a mailto: or https: address the push service can contact
 * @param {number} options.now
 */
export async function createVapidAuthorization({ endpoint, signingKey, subject, now }) {
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + TOKEN_LIFETIME_S,
    sub: subject,
  };
  const unsigned = [header, claims]
    .map((part) => encodeBase64Url(textEncoder.encode(JSON.stringify(part))))
    .join(".");
  const key = await crypto.subtle.importKey("jwk", signingKey, ECDSA, false, ["sign"]);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    textEncoder.encode(unsigned),
  );
  const token = `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
  return `vapid t=${token}, k=${readApplicationServerKey(signingKey)}`;
}

async function deriveHkdf(salt, secret, info, length) {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function createLocalKeys() {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  return crypto.subtle.exportKey("jwk", pair.privateKey);
}

/**
 * The aes128gcm body for one message, in a single record.
 * @param {object} options
 * @param {Uint8Array} options.payload
 * @param {string} options.p256dh the browser's public key, base64url
 * @param {string} options.auth the browser's auth secret, base64url
 * @param {JsonWebKey} [options.localKey] this message's own ECDH key; made fresh when omitted
 * @param {Uint8Array} [options.salt] made fresh when omitted
 */
export async function encryptPayload({
  payload,
  p256dh,
  auth,
  localKey,
  salt = crypto.getRandomValues(new Uint8Array(16)),
}) {
  const privateJwk = localKey ?? (await createLocalKeys());
  const browserKey = decodeBase64Url(p256dh);
  const localPublicKey = readPublicKey(privateJwk);
  const privateKey = await crypto.subtle.importKey("jwk", privateJwk, ECDH, false, ["deriveBits"]);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    describePublicKey(browserKey),
    ECDH,
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256),
  );

  const keyInfo = joinBytes(textEncoder.encode("WebPush: info\0"), browserKey, localPublicKey);
  const inputKey = await deriveHkdf(decodeBase64Url(auth), sharedSecret, keyInfo, 32);
  const contentKey = await deriveHkdf(
    salt,
    inputKey,
    textEncoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await deriveHkdf(
    salt,
    inputKey,
    textEncoder.encode("Content-Encoding: nonce\0"),
    12,
  );

  // 0x02 marks the last record, with no padding after it.
  const record = joinBytes(payload, [2]);
  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE);
  return joinBytes(salt, recordSize, [localPublicKey.length], localPublicKey, ciphertext);
}

/**
 * Delivers one message, and resolves to the push service's status: 201 when accepted, 404 or 410
 * when the subscription is gone. It rejects when the push service doesn't answer in time.
 * @param {object} options
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} options.subscription
 * @param {object} options.message sent as JSON
 * @param {JsonWebKey} options.signingKey
 * @param {string} options.subject
 * @param {number} options.now
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.ttlSeconds]
 */
export async function sendPush({
  subscription,
  message,
  signingKey,
  subject,
  now,
  ttlSeconds = MESSAGE_TTL_S,
  fetchImpl = (input, init) => fetch(input, init),
}) {
  const body = await encryptPayload({
    payload: textEncoder.encode(JSON.stringify(message)),
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  });
  const authorization = await createVapidAuthorization({
    endpoint: subscription.endpoint,
    signingKey,
    subject,
    now,
  });
  const headers = {
    authorization,
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(Math.max(0, Math.floor(ttlSeconds))),
    urgency: "normal",
  };
  return abortAfter(SEND_TIMEOUT_MS, async (signal) => {
    const response = await fetchImpl(subscription.endpoint, {
      method: "POST",
      headers,
      body,
      signal,
    });
    return response.status;
  });
}
