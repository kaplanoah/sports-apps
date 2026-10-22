// A Worker with the ACCESS_CODE secret asks for that code before its page opens. A phone that
// sends it gets a cookie signed over the code with ACCESS_SIGNING_KEY, so a new code signs every
// phone out, and the Worker holds nothing about who has signed in. The signing key is its own
// secret because the page's key is in every link, and a cookie signed with it could be made, and
// a code guessed, without ever meeting the limit on tries.
import { respondError, respondJson, respondMethodNotAllowed } from "./responses.js";

export const ACCESS_PATH = "/access";

const COOKIE_NAME = "access";
// Browsers keep a cookie 400 days at most, and every visit to the page starts the count again.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const textEncoder = new TextEncoder();

/**
 * The code as it's compared: phones capitalize, space, and hyphenate what's typed on their own.
 * @param {string} text
 */
export const normalizeCode = (text) => text.replace(/[\s-]/g, "").toUpperCase();

function encodeBase64Url(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} text
 * @param {string} signingKey
 */
async function signText(text, signingKey) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBase64Url(await crypto.subtle.sign("HMAC", key, textEncoder.encode(text)));
}

/**
 * @param {string} code
 * @param {string} signingKey
 */
const signCode = (code, signingKey) => signText(normalizeCode(code), signingKey);

// Every character is compared, so how long a check takes says nothing about how close a guess was.
/**
 * @param {string} first
 * @param {string} second
 */
function isSameText(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

/** @param {Request} request */
function readAccessCookie(request) {
  for (const cookie of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return null;
}

/**
 * Whether the phone may see the page: "open" when it may, "missing" when it never sent the
 * code, and "changed" when the code it sent is no longer the one asked for.
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<"open" | "missing" | "changed">}
 */
export async function readAccess(request, env) {
  if (!env.ACCESS_CODE) return "open";
  const cookie = readAccessCookie(request);
  if (cookie === null || !env.ACCESS_SIGNING_KEY) return "missing";
  const expected = await signCode(env.ACCESS_CODE, env.ACCESS_SIGNING_KEY);
  return isSameText(cookie, expected) ? "open" : "changed";
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {string} prefix what the page's paths start with at the address the phone used
 */
export async function createAccessCookie(request, env, prefix) {
  const isSecure = new URL(request.url).protocol === "https:";
  return [
    `${COOKIE_NAME}=${await signCode(env.ACCESS_CODE, env.ACCESS_SIGNING_KEY)}`,
    `Path=${prefix}/`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    // Lax, not Strict, so a link tapped in another site's page still opens the app.
    "SameSite=Lax",
    ...(isSecure ? ["Secure"] : []),
  ].join("; ");
}

// Without the binding, as in tests, nothing limits how often a phone tries.
/**
 * @param {Request} request
 * @param {any} env
 */
async function isWithinTryLimit(request, env) {
  if (!env.ACCESS_LIMIT) return true;
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.ACCESS_LIMIT.limit({
    key: `${new URL(request.url).hostname} ${address}`,
  });
  return success;
}

/** @param {Request} request */
async function readSentCode(request) {
  const body = await request.json().catch(() => null);
  return typeof body?.code === "string" ? body.code : null;
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {string} prefix
 */
async function checkSentCode(request, env, prefix) {
  const code = await readSentCode(request);
  if (code === null) return respondError(400, "bad_request", "Send the code as { code }.");
  if (!env.ACCESS_SIGNING_KEY)
    return respondError(503, "not_ready", "The Worker has no ACCESS_SIGNING_KEY to sign in with.");
  if (!(await isWithinTryLimit(request, env)))
    return respondError(429, "too_many_tries", "Too many tries. Try again in a minute.");
  const expected = await signCode(env.ACCESS_CODE, env.ACCESS_SIGNING_KEY);
  if (!isSameText(await signCode(code, env.ACCESS_SIGNING_KEY), expected))
    return respondError(401, "wrong_code", "That code isn't right.");
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": await createAccessCookie(request, env, prefix) },
  });
}

// A Home Screen app keeps its cookies apart from the browser's, so its link that opens the page in
// the browser carries a handoff: an address that signs the browser in for a few minutes, long
// enough to tap the link, and only while the code it was made under is still the one asked for.
export const HANDOFF_PATH = `${ACCESS_PATH}/handoff`;
const HANDOFF_SECONDS = 10 * 60;
const HANDOFF_TOKEN_KEY = "token";

// Its text holds spaces, which a normalized code never does, so a cookie can't stand in for it.
/**
 * @param {string} expiresAt seconds since 1970
 * @param {any} env
 */
const signHandoff = (expiresAt, env) =>
  signText(`handoff ${expiresAt} ${normalizeCode(env.ACCESS_CODE)}`, env.ACCESS_SIGNING_KEY);

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} address the handoff's route where the browser redeems it
 */
async function createHandoff(request, env, address) {
  if (!env.ACCESS_CODE) return respondNeedsNoCode();
  if ((await readAccess(request, env)) !== "open") return respondAccessRequired();
  const expiresAt = String(Math.floor(Date.now() / 1000) + HANDOFF_SECONDS);
  address.searchParams.set(HANDOFF_TOKEN_KEY, `${expiresAt}.${await signHandoff(expiresAt, env)}`);
  return respondJson({ address: address.href, expiresInMs: HANDOFF_SECONDS * 1000 });
}

/**
 * @param {string | null} token
 * @param {any} env
 */
async function isValidHandoff(token, env) {
  if (token === null || !env.ACCESS_CODE || !env.ACCESS_SIGNING_KEY) return false;
  const [expiresAt, signature = ""] = token.split(".");
  if (!(Number(expiresAt) >= Date.now() / 1000)) return false;
  return isSameText(signature, await signHandoff(expiresAt, env));
}

// The page opens at its own address, keeping the rest of the handoff's, and never the token, so
// neither the browser's history nor a Home Screen app added from it keeps one.
/**
 * @param {Request} request
 * @param {any} env
 * @param {string} prefix
 */
async function redeemHandoff(request, env, prefix) {
  const url = new URL(request.url);
  const page = new URL(`${prefix}/`, url);
  for (const [name, value] of url.searchParams)
    if (name !== HANDOFF_TOKEN_KEY) page.searchParams.append(name, value);
  const headers = new Headers({ location: page.href, "cache-control": "no-store" });
  if (await isValidHandoff(url.searchParams.get(HANDOFF_TOKEN_KEY), env))
    headers.set("set-cookie", await createAccessCookie(request, env, prefix));
  return new Response(null, { status: 302, headers });
}

/**
 * The handoff's route: a POST from a phone signed in makes one, and a GET of the address it
 * makes signs the browser in and opens the page.
 * @param {Request} request
 * @param {any} env
 * @param {string} prefix what the page's paths start with at the address the phone used
 */
export function serveHandoff(request, env, prefix) {
  if (request.method === "POST")
    return createHandoff(request, env, new URL(`${prefix}${HANDOFF_PATH}`, request.url));
  if (request.method === "GET") return redeemHandoff(request, env, prefix);
  return respondMethodNotAllowed(["GET", "POST"]);
}

// The page under its key moves to the address PAGE_HOST names, which shares its code, so a phone
// signed in under the key arrives there signed in. Both addresses check the code with the same
// signing key, and the handoff's own route at PAGE_HOST redeems it, keeping its cookie to that host.
export const MOVE_PATH = `${ACCESS_PATH}/move`;

/**
 * @param {string} path
 * @param {any} env
 */
export const buildPageHostAddress = (path, env) => new URL(path, `https://${env.PAGE_HOST}`);

/**
 * The move's route, only while the Worker has PAGE_HOST: a POST from a phone signed in under the
 * key makes a handoff there.
 * @param {Request} request
 * @param {any} env
 */
export function serveMoveHandoff(request, env) {
  if (request.method !== "POST") return respondMethodNotAllowed(["POST"]);
  return createHandoff(request, env, buildPageHostAddress(HANDOFF_PATH, env));
}

/**
 * The page's access route: a GET says whether the phone's code has changed, and a POST of the
 * code signs the phone in.
 * @param {Request} request
 * @param {any} env
 * @param {string} prefix what the page's paths start with at the address the phone used
 */
export async function serveAccess(request, env, prefix) {
  if (!env.ACCESS_CODE) return respondNeedsNoCode();
  if (request.method === "GET")
    return respondJson({ isChanged: (await readAccess(request, env)) === "changed" });
  if (request.method === "POST") return checkSentCode(request, env, prefix);
  return respondMethodNotAllowed(["GET", "POST"]);
}

export const respondAccessRequired = () =>
  respondError(401, "access_required", "This page needs its access code.");

const respondNeedsNoCode = () => respondError(404, "not_found", "This page needs no code.");
