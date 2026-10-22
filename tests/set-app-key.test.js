import test from "node:test";
import assert from "node:assert/strict";
import { createKey, setAppKey } from "../worker/set-app-key.mjs";
import { createFakeCloudflare } from "./fake-cloudflare.js";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123", CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain" };
const API = "https://api.cloudflare.com/client/v4/accounts/acct123/workers";

test("a new key is stored as a secret, and the page's address is printed", async () => {
  const cloudflare = createFakeCloudflare();
  const printed = [];
  const url = await setAppKey({
    app: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    log: (line) => printed.push(line),
    makeKey: () => "n3wkey",
  });
  assert.equal(url, "https://mlb-app.example-subdomain.workers.dev/n3wkey/");
  const put = cloudflare.calls.find((call) => call.init.method === "PUT");
  assert.equal(put.url, `${API}/scripts/mlb-app/secrets`);
  assert.deepEqual(JSON.parse(put.init.body), {
    name: "APP_KEY",
    text: "n3wkey",
    type: "secret_text",
  });
  assert.ok(printed.includes(`Page address: ${url}`));
});

test("an existing key is replaced only when asked to rotate", async () => {
  const secrets = [{ name: "APP_KEY", type: "secret_text" }];
  const kept = createFakeCloudflare({ secrets });
  await assert.rejects(
    setAppKey({ app: "mlb", fetchImpl: kept.fetchImpl, env: ENV, log: () => {} }),
    /already has an APP_KEY.*--rotate/s,
  );
  assert.ok(!kept.calls.some((call) => call.init.method === "PUT"));

  const rotated = createFakeCloudflare({ secrets });
  await setAppKey({
    app: "mlb",
    fetchImpl: rotated.fetchImpl,
    env: ENV,
    log: () => {},
    isRotating: true,
  });
  assert.ok(rotated.calls.some((call) => call.init.method === "PUT"));
});

test("keys are long, random, and safe in an address", () => {
  const keys = new Set(Array.from({ length: 20 }, createKey));
  assert.equal(keys.size, 20);
  for (const key of keys) assert.match(key, /^[A-Za-z0-9_-]{32}$/);
});

test("the beta channel's key goes to the beta Worker, whose address it prints", async () => {
  const cloudflare = createFakeCloudflare();
  const url = await setAppKey({
    app: "mlb",
    channel: "beta",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    log: () => {},
    makeKey: () => "n3wkey",
  });
  assert.equal(url, "https://mlb-app-beta.example-subdomain.workers.dev/n3wkey/");
  const put = cloudflare.calls.find((call) => call.init.method === "PUT");
  assert.equal(put.url, `${API}/scripts/mlb-app-beta/secrets`);
});

test("the address comes from the subdomain's variable, and a missing one stops before anything is sent", async () => {
  const cloudflare = createFakeCloudflare();
  await setAppKey({ app: "mlb", fetchImpl: cloudflare.fetchImpl, env: ENV, log: () => {} });
  assert.ok(!cloudflare.calls.some((call) => call.url.endsWith("/workers/subdomain")));

  const unnamed = createFakeCloudflare();
  await assert.rejects(
    setAppKey({
      app: "mlb",
      fetchImpl: unnamed.fetchImpl,
      env: { CLOUDFLARE_ACCOUNT_ID: "acct123" },
      log: () => {},
    }),
    /Set CLOUDFLARE_WORKERS_SUBDOMAIN/,
  );
  assert.deepEqual(unnamed.calls, []);
});
