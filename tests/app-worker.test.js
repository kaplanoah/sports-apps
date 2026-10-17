import test from "node:test";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { createAppWorker } from "../shared/worker/app-worker.js";

const answerNothing = () => new Response(null, { status: 500 });
const storeAnswers = async () => true;

/** @param {Record<string, { contentType: string, text?: string }>} pageFiles */
const createPageWorker = (pageFiles) =>
  createAppWorker({
    pageFiles,
    serveSnapshot: answerNothing,
    forwardToStore: answerNothing,
    isStoreAnswering: storeAnswers,
  });

/** @param {Record<string, { contentType: string, text?: string }>} pageFiles */
const requestRobots = (pageFiles) =>
  createPageWorker(pageFiles).fetch(new Request("https://worker.example/robots.txt"), {});

test("robots.txt names the commit the Worker was built from, and none when the build named none", async () => {
  const release = { version: "1.2.3", commit: "abc1234", builtAt: "2026-10-01T20:00:00Z" };
  const built = await requestRobots({
    "version.json": { contentType: "application/json", text: JSON.stringify(release) },
  });
  assert.equal(built.headers.get("x-release-commit"), "abc1234");
  assert.equal(await built.text(), "User-agent: *\nDisallow: /\n");

  const unnamed = await requestRobots({});
  assert.equal(unnamed.headers.get("x-release-commit"), null);
});

test("health answers without the key, saying whether the store answers and which release this is", async () => {
  const release = { version: "1.2.3", commit: "abc1234", builtAt: "2026-10-01T20:00:00Z" };
  const pageFiles = {
    "version.json": { contentType: "application/json", text: JSON.stringify(release) },
  };
  const env = { APP_KEY: "key", STORE: "the store" };

  const healthy = await createPageWorker(pageFiles).fetch(
    new Request("https://worker.example/health"),
    env,
  );
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { ok: true, release: "abc1234", store: "ok" });
  assert.equal(healthy.headers.get("x-robots-tag"), "noindex, nofollow");

  const unhealthy = await createAppWorker({
    pageFiles,
    serveSnapshot: answerNothing,
    forwardToStore: answerNothing,
    isStoreAnswering: async () => false,
  }).fetch(new Request("https://worker.example/health"), env);
  assert.equal(unhealthy.status, 503);
  assert.deepEqual(await unhealthy.json(), { ok: false, release: "abc1234", store: "no answer" });
});

/**
 * @param {ReturnType<typeof createPageWorker>} worker
 * @param {string} path
 */
const requestPageFile = (worker, path) =>
  worker.fetch(new Request(`https://worker.example/key/${path}`), { APP_KEY: "key" });

test("a release's own folder serves its files for good, and another release's folder serves nothing", async () => {
  const release = { version: "1.2.3", commit: "abc1234", builtAt: "2026-10-01T20:00:00Z" };
  const worker = createPageWorker({
    "version.json": { contentType: "application/json", text: JSON.stringify(release) },
    "styles.css": { contentType: "text/css; charset=utf-8", text: "body {}" },
  });

  const pinned = await requestPageFile(worker, "release/abc1234/styles.css");
  assert.equal(pinned.status, 200);
  assert.equal(await pinned.text(), "body {}");
  assert.equal(pinned.headers.get("cache-control"), "public, max-age=31536000, immutable");

  const unpinned = await requestPageFile(worker, "styles.css");
  assert.equal(await unpinned.text(), "body {}");
  assert.equal(unpinned.headers.get("cache-control"), "no-cache");

  const otherRelease = await requestPageFile(worker, "release/def5678/styles.css");
  assert.equal(otherRelease.status, 404);
  assert.equal(otherRelease.headers.get("cache-control"), "no-cache");
});

test("another release's version file names that release, so a page still running it reloads", async () => {
  const release = { version: "1.2.3", commit: "abc1234", builtAt: "2026-10-01T20:00:00Z" };
  const worker = createPageWorker({
    "version.json": { contentType: "application/json", text: JSON.stringify(release) },
  });

  const replaced = await requestPageFile(worker, "release/def5678/version.json");
  assert.equal(replaced.status, 200);
  assert.deepEqual(await replaced.json(), { version: null, commit: "def5678", builtAt: null });
  assert.equal(replaced.headers.get("cache-control"), "no-store");

  const own = await requestPageFile(worker, "release/abc1234/version.json");
  assert.deepEqual(await own.json(), release);
});

test("a Worker built without a release has no release folder", async () => {
  const worker = createPageWorker({
    "styles.css": { contentType: "text/css; charset=utf-8", text: "body {}" },
  });

  assert.equal((await requestPageFile(worker, "release/abc1234/styles.css")).status, 404);
});

const PAGE_FILES = {
  "index.html": { contentType: "text/html", text: "the app" },
  "gate.html": { contentType: "text/html", text: "the gate" },
  "styles.css": { contentType: "text/css", text: "body {}" },
};

const answerOk = () => new Response("data");

function createLockedWorker() {
  return createAppWorker({
    pageFiles: PAGE_FILES,
    serveSnapshot: answerOk,
    forwardToStore: answerOk,
    isStoreAnswering: storeAnswers,
    reads: { "/box-score": answerOk },
  });
}

const LOCKED_ENV = { APP_KEY: "key", ACCESS_CODE: "fast break", ACCESS_SIGNING_KEY: "signing" };

/**
 * @param {string} path under the page's key
 * @param {{ method?: string, cookie?: string, body?: unknown, env?: object, origin?: string }} [options]
 */
function requestLocked(
  path,
  { method = "GET", cookie, body, env = LOCKED_ENV, origin = "https://worker.example" } = {},
) {
  const headers = { "cf-connecting-ip": "203.0.113.7", ...(cookie && { cookie }) };
  const init = { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) };
  return createLockedWorker().fetch(new Request(`${origin}/key${path}`, init), env);
}

const readCookie = (response) => response.headers.get("set-cookie")?.split(";")[0] ?? null;

async function signIn(env = LOCKED_ENV) {
  const response = await requestLocked("/access", {
    method: "POST",
    body: { code: "FASTBREAK" },
    env,
  });
  return readCookie(response);
}

test("an app's own read gets the Worker's bindings, so it can read the store", async () => {
  /** @type {any[]} */
  const handed = [];
  const worker = createAppWorker({
    pageFiles: PAGE_FILES,
    serveSnapshot: answerNothing,
    forwardToStore: answerNothing,
    isStoreAnswering: storeAnswers,
    reads: {
      "/roster": (url, env) => {
        handed.push([url.searchParams.get("team"), env.STORE]);
        return answerOk();
      },
    },
  });
  const env = { APP_KEY: "key", STORE: "the store" };

  const response = await worker.fetch(
    new Request("https://worker.example/key/roster?team=NYL"),
    env,
  );

  assert.equal(await response.text(), "data");
  assert.deepEqual(handed, [["NYL", "the store"]]);
});

const DATA_PATHS = ["/snapshot", "/box-score", "/store/seasons/2026", "/watch", "/push/key"];

test("without an access code, the page and its data open as they always have", async () => {
  const env = { APP_KEY: "key" };
  const page = await requestLocked("/", { env });
  assert.equal(await page.text(), "the app");
  assert.equal(page.headers.get("set-cookie"), null);
  for (const path of DATA_PATHS) assert.equal((await requestLocked(path, { env })).status, 200);
  assert.equal((await requestLocked("/access", { env })).status, 404);
});

test("until the code is sent, the page's address shows the gate and its data stays locked", async () => {
  for (const path of ["/", "/index.html"]) {
    const gate = await requestLocked(path);
    assert.equal(gate.status, 200);
    assert.equal(await gate.text(), "the gate");
    assert.equal(gate.headers.get("cache-control"), "no-store");
  }
  assert.equal(await (await requestLocked("/styles.css")).text(), "body {}");
  for (const path of DATA_PATHS) {
    const locked = await requestLocked(path);
    assert.equal(locked.status, 401, path);
    assert.equal((await locked.json()).error.code, "access_required");
  }
  assert.deepEqual(await (await requestLocked("/access")).json(), { isChanged: false });
});

test("the right code, however it's typed, signs the phone in with a cookie for the page", async () => {
  for (const code of ["FASTBREAK", "fast-break", " Fast Break "]) {
    const response = await requestLocked("/access", { method: "POST", body: { code } });
    assert.equal(response.status, 204, code);
    const attributes = response.headers.get("set-cookie").split("; ");
    assert.match(attributes[0], /^access=[\w-]{43}$/);
    assert.deepEqual(attributes.slice(1), [
      "Path=/key/",
      `Max-Age=${400 * 24 * 60 * 60}`,
      "HttpOnly",
      "SameSite=Lax",
      "Secure",
    ]);
  }
  const cookie = await signIn();
  const page = await requestLocked("/", { cookie });
  assert.equal(await page.text(), "the app");
  assert.equal(readCookie(page), cookie);
  for (const path of DATA_PATHS) assert.equal((await requestLocked(path, { cookie })).status, 200);
});

test("a wrong code, or none, signs nothing in", async () => {
  const wrong = await requestLocked("/access", { method: "POST", body: { code: "layup" } });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error.code, "wrong_code");
  assert.equal(wrong.headers.get("set-cookie"), null);

  const empty = await requestLocked("/access", { method: "POST", body: {} });
  assert.equal(empty.status, 400);
  assert.equal((await requestLocked("/", { cookie: "access=made-up" })).status, 200);
  assert.equal((await requestLocked("/snapshot", { cookie: "access=made-up" })).status, 401);
});

test("a new code signs every phone out, and the gate can say so", async () => {
  const cookie = await signIn();
  const env = { ...LOCKED_ENV, ACCESS_CODE: "LAYUP" };
  assert.equal(await (await requestLocked("/", { cookie, env })).text(), "the gate");
  assert.equal((await requestLocked("/snapshot", { cookie, env })).status, 401);
  assert.deepEqual(await (await requestLocked("/access", { cookie, env })).json(), {
    isChanged: true,
  });
});

test("a cookie anyone with the link could make from its key and a guessed code opens nothing", async () => {
  const guessed = createHmac("sha256", "key").update("FASTBREAK").digest("base64url");
  const cookie = `access=${guessed}`;
  assert.equal(await (await requestLocked("/", { cookie })).text(), "the gate");
  assert.equal((await requestLocked("/snapshot", { cookie })).status, 401);
});

test("a code without a key to sign with keeps the page locked and signs no one in", async () => {
  const env = { APP_KEY: "key", ACCESS_CODE: "fast break" };
  const response = await requestLocked("/access", {
    method: "POST",
    body: { code: "FASTBREAK" },
    env,
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await (await requestLocked("/", { env })).text(), "the gate");
});

test("too many tries from one address are turned away, even with the right code", async () => {
  const keys = [];
  const env = {
    ...LOCKED_ENV,
    ACCESS_LIMIT: { limit: async ({ key }) => (keys.push(key), { success: false }) },
  };
  const response = await requestLocked("/access", {
    method: "POST",
    body: { code: "FASTBREAK" },
    env,
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "too_many_tries");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(keys, ["worker.example 203.0.113.7"]);
});

test("a page served over plain http, as on a laptop, gets a cookie it can keep", async () => {
  const response = await requestLocked("/access", {
    method: "POST",
    body: { code: "FASTBREAK" },
    origin: "http://127.0.0.1:4173",
  });
  assert.ok(!response.headers.get("set-cookie").includes("Secure"));
});

const PAGE_HOST = "mlb.sports.example";
const PAGE_HOST_ENV = { ...LOCKED_ENV, PAGE_HOST };

/**
 * @param {string} path at the page's own address, with no key
 * @param {{ method?: string, cookie?: string, body?: unknown, env?: object }} [options]
 */
function requestAtPageHost(path, { method = "GET", cookie, body, env = PAGE_HOST_ENV } = {}) {
  const headers = { "cf-connecting-ip": "203.0.113.7", ...(cookie && { cookie }) };
  const init = { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) };
  return createLockedWorker().fetch(new Request(`https://${PAGE_HOST}${path}`, init), env);
}

test("at the page's own address, the page and its data answer without the key, behind the code", async () => {
  assert.equal(await (await requestAtPageHost("/")).text(), "the gate");
  for (const path of DATA_PATHS) assert.equal((await requestAtPageHost(path)).status, 401, path);

  const signedIn = await requestAtPageHost("/access", {
    method: "POST",
    body: { code: "FASTBREAK" },
  });
  assert.equal(signedIn.status, 204);
  assert.equal(signedIn.headers.get("set-cookie").split("; ")[1], "Path=/");
  const cookie = readCookie(signedIn);
  const page = await requestAtPageHost("/", { cookie });
  assert.equal(await page.text(), "the app");
  assert.equal(page.headers.get("set-cookie").split("; ")[1], "Path=/");
  for (const path of DATA_PATHS)
    assert.equal((await requestAtPageHost(path, { cookie })).status, 200, path);
});

test("the page's own address answers nothing while the Worker has no code", async () => {
  const env = { APP_KEY: "key", PAGE_HOST };
  for (const path of ["/", "/index.html", "/styles.css", "/access", ...DATA_PATHS])
    assert.equal((await requestAtPageHost(path, { env })).status, 404, path);
});

test("with an address of its own, the page still answers under its key, and only there on the Worker's address", async () => {
  assert.equal(await (await requestLocked("/", { env: PAGE_HOST_ENV })).text(), "the gate");
  const cookie = await signIn(PAGE_HOST_ENV);
  const page = await requestLocked("/", { cookie, env: PAGE_HOST_ENV });
  assert.equal(await page.text(), "the app");
  assert.equal(page.headers.get("set-cookie").split("; ")[1], "Path=/key/");

  const keyless = await createLockedWorker().fetch(
    new Request("https://worker.example/"),
    PAGE_HOST_ENV,
  );
  assert.equal(keyless.status, 404);
  assert.equal((await requestAtPageHost("/key/", { cookie })).status, 404);
});

const AGENTS = {
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iPad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

test("Safari's manifest leaves out start_url, so a Home Screen app opens at the address it was added from, and Chrome's keeps it", async () => {
  const manifest = { name: "WNBA", id: "./", start_url: "./", scope: "./" };
  const worker = createPageWorker({
    "manifest.webmanifest": {
      contentType: "application/manifest+json",
      text: JSON.stringify(manifest),
    },
  });
  /** @param {string} agent */
  const requestManifest = (agent) =>
    worker.fetch(
      new Request("https://worker.example/key/manifest.webmanifest", {
        headers: { "user-agent": agent },
      }),
      { APP_KEY: "key" },
    );

  const { start_url: _startUrl, ...withoutStartUrl } = manifest;
  for (const agent of [AGENTS.iPhone, AGENTS.iPad])
    assert.deepEqual(await (await requestManifest(agent)).json(), withoutStartUrl);
  for (const agent of [AGENTS.android, AGENTS.macChrome])
    assert.deepEqual(await (await requestManifest(agent)).json(), manifest);
  const safari = await requestManifest(AGENTS.iPhone);
  const chrome = await requestManifest(AGENTS.android);
  assert.notEqual(safari.headers.get("etag"), chrome.headers.get("etag"));
  assert.equal(safari.headers.get("vary"), "user-agent");
});
