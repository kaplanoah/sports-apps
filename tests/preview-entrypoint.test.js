import test from "node:test";
import assert from "node:assert/strict";
import { createAppWorker } from "../shared/worker/app-worker.js";
import { createPreviewEntrypoint } from "../shared/worker/preview-entrypoint.js";

const BETA_ENV = {
  APP_KEY: "k3y",
  ACCESS_CODE: "fast break",
  ACCESS_SIGNING_KEY: "signing",
  STORE: "beta's store",
};

/** @param {string} owner */
const listPageFiles = (owner) => ({
  "index.html": { contentType: "text/html", text: `${owner} app` },
  "gate.html": { contentType: "text/html", text: `${owner} gate` },
  "styles.css": { contentType: "text/css", text: `${owner} styles` },
});

/**
 * Beta's Worker behind its preview entrypoint, with what its store and reads were asked.
 * @param {object} [env]
 */
function createBeta(env = BETA_ENV) {
  /** @type {{ path: string, store: unknown, upgrade: string | null }[]} */
  const asked = [];
  /** @param {string} path */
  const recordAsked = (path) => (/** @type {Request} */ request, /** @type {any} */ storeEnv) => {
    asked.push({ path, store: storeEnv.STORE, upgrade: request.headers.get("upgrade") });
    return new Response(`beta's ${path}`);
  };
  const worker = createAppWorker({
    pageFiles: listPageFiles("beta's"),
    forwardToStore: (request, storeEnv, appPath) => recordAsked(appPath)(request, storeEnv),
    isStoreAnswering: async () => true,
    reads: { "/box-score": (url, readEnv) => recordAsked("/box-score")(new Request(url), readEnv) },
  });
  const PreviewEntrypoint = createPreviewEntrypoint(worker);
  return { binding: new PreviewEntrypoint({}, env), asked };
}

const preview = createAppWorker({
  pageFiles: listPageFiles("the preview's"),
  forwardToStore: () => assert.fail("the preview read a store of its own"),
  isStoreAnswering: () => assert.fail("the preview asked a store of its own"),
  reads: { "/box-score": () => assert.fail("the preview read the league itself") },
});

// A preview's only binding is beta's, so reading any other is a bug that would find nothing.
/** @param {unknown} beta */
const createPreviewEnv = (beta) =>
  new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "BETA") return beta;
        assert.fail(`the preview read its own ${String(key)}`);
      },
    },
  );

/**
 * @param {ReturnType<typeof createBeta>} beta
 * @param {string} path under beta's key
 * @param {{ method?: string, cookie?: string, body?: unknown, headers?: Record<string, string> }} [options]
 */
function requestPreview(beta, path, { method = "GET", cookie, body, headers = {} } = {}) {
  const init = {
    method,
    headers: { "cf-connecting-ip": "203.0.113.7", ...headers, ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  };
  return preview.fetch(
    new Request(`https://pr-12.previews.example/k3y${path}`, init),
    createPreviewEnv(beta.binding),
  );
}

/** @param {Response} response */
const readCookie = (response) => response.headers.get("set-cookie")?.split(";")[0] ?? null;

/** @param {ReturnType<typeof createBeta>} beta */
async function signIn(beta) {
  const response = await requestPreview(beta, "/access", {
    method: "POST",
    body: { code: "FASTBREAK" },
  });
  assert.equal(response.status, 204);
  return String(readCookie(response));
}

test("a preview shows its own gate until beta signs the phone in with beta's code, then its own page", async () => {
  const beta = createBeta();
  const gate = await requestPreview(beta, "/");
  assert.equal(await gate.text(), "the preview's gate");
  assert.equal(gate.headers.get("cache-control"), "no-store");

  const cookie = await signIn(beta);
  const page = await requestPreview(beta, "/", { cookie });
  assert.equal(await page.text(), "the preview's app");
  assert.equal(readCookie(page), cookie);

  const wrongCode = await requestPreview(beta, "/access", {
    method: "POST",
    body: { code: "LAYUP" },
  });
  assert.equal(wrongCode.status, 401);
});

test("a preview's page files are its own, and open before the phone signs in", async () => {
  const styles = await requestPreview(createBeta(), "/styles.css");
  assert.equal(await styles.text(), "the preview's styles");
});

test("a preview's data, live connection, and push come from beta's store, behind beta's code", async () => {
  const beta = createBeta();
  const locked = await requestPreview(beta, "/store/seasons/2026");
  assert.equal(locked.status, 401);
  assert.deepEqual(beta.asked, []);

  const cookie = await signIn(beta);
  const watch = await requestPreview(beta, "/watch", {
    cookie,
    headers: { upgrade: "websocket" },
  });
  assert.equal(await watch.text(), "beta's /watch");
  for (const path of ["/store/seasons/2026", "/push/key", "/box-score"]) {
    const response = await requestPreview(beta, path, { cookie });
    assert.equal(await response.text(), `beta's ${path}`, path);
  }
  assert.deepEqual(beta.asked, [
    { path: "/watch", store: "beta's store", upgrade: "websocket" },
    { path: "/store/seasons/2026", store: "beta's store", upgrade: null },
    { path: "/push/key", store: "beta's store", upgrade: null },
    { path: "/box-score", store: "beta's store", upgrade: null },
  ]);
});

test("a preview's handoff and health are beta's", async () => {
  const beta = createBeta();
  const cookie = await signIn(beta);
  const handoff = await requestPreview(beta, "/access/handoff", { method: "POST", cookie });
  const { address } = await handoff.json();
  assert.equal(new URL(address).pathname, "/k3y/access/handoff");
  const opened = await preview.fetch(new Request(address), createPreviewEnv(beta.binding));
  assert.equal(readCookie(opened), cookie);

  const health = await preview.fetch(
    new Request("https://pr-12.previews.example/health"),
    createPreviewEnv(beta.binding),
  );
  assert.equal(health.status, 200);
  assert.equal((await health.json()).store, "ok");
});

test("a preview answers nothing without beta's key, and the folder's address goes to the folder", async () => {
  const beta = createBeta();
  const unkeyed = await preview.fetch(
    new Request("https://pr-12.previews.example/other/"),
    createPreviewEnv(beta.binding),
  );
  assert.equal(unkeyed.status, 404);
  const folder = await requestPreview(beta, "");
  assert.equal(folder.status, 301);
  assert.equal(folder.headers.get("location"), "/k3y/");
});

test("beta's code changing signs a preview's phones out, as it does beta's", async () => {
  const cookie = await signIn(createBeta());
  const changed = createBeta({ ...BETA_ENV, ACCESS_CODE: "LAYUP" });
  const page = await requestPreview(changed, "/", { cookie });
  assert.equal(await page.text(), "the preview's gate");
  const data = await requestPreview(changed, "/store/seasons/2026", { cookie });
  assert.equal(data.status, 401);
});
