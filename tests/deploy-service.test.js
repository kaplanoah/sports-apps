import test from "node:test";
import assert from "node:assert/strict";
import { deploy, deployWorkers } from "../worker/deploy.mjs";
import { createServiceRoots } from "./service-roots.js";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123", CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain" };
const API = "https://api.cloudflare.com/client/v4";
const NEW_COMMIT = "2".repeat(40);
const LIVE_DEPLOYMENTS = [
  { id: "d-live", versions: [{ version_id: "v-live", percentage: 100 }], created_on: "" },
];
const skipPause = async () => {};

/**
 * @param {{ ok: boolean, release: string | null, problem?: string } | null} report what each app says of accounts
 * @param {{ appStatus?: number }} [options]
 */
const answerHealth =
  (report, { appStatus = 200 } = {}) =>
  () =>
    new Response(
      JSON.stringify({ ok: appStatus === 200, ...(report && { services: { accounts: report } }) }),
      { status: appStatus },
    );

/** @param {() => Response} answerApp */
function createFakeCloudflare(answerApp) {
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (!url.startsWith(API)) return answerApp();
    let result = {};
    if (url.endsWith("/deployments") && init.method === "GET")
      result = { deployments: LIVE_DEPLOYMENTS };
    if (url.endsWith("/workers/scripts")) result = [{ id: "accounts", migration_tag: "v1" }];
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}

/**
 * @param {() => Response} answerApp
 * @param {{ worker?: string, channel?: string }} [options]
 */
async function deployWorker(answerApp, { worker = "accounts", channel } = {}) {
  const { roots, remove } = createServiceRoots();
  const cloudflare = createFakeCloudflare(answerApp);
  const lines = [];
  try {
    const result = await deploy({
      worker,
      channel,
      roots,
      script: "export default {}",
      commit: NEW_COMMIT,
      findChanges: () => null,
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      log: (line) => lines.push(line),
      pause: skipPause,
      checkPage: async ({ app }) => {
        assert.notEqual(app, "accounts", "a service has no page to check");
        return { status: "drawn" };
      },
    }).catch((error) => error);
    return { result, lines, calls: cloudflare.calls };
  } finally {
    remove();
  }
}

const RELEASED = { ok: true, release: NEW_COMMIT.slice(0, 7) };

test("a service uploads its store and version, has no workers.dev address, and answers through each app's health", async () => {
  const { result, lines, calls } = await deployWorker(answerHealth(RELEASED));
  assert.equal(result, "accounts");
  const upload = calls.find(({ init }) => init.method === "PUT");
  const metadata = JSON.parse(await upload.init.body.get("metadata").text());
  assert.deepEqual(metadata.bindings, [
    { type: "durable_object_namespace", name: "STORE", class_name: "AccountStore" },
    { type: "version_metadata", name: "VERSION" },
  ]);
  const route = calls.find(({ url }) => url.endsWith("/scripts/accounts/subdomain"));
  assert.deepEqual(JSON.parse(route.init.body), { enabled: false, previews_enabled: false });
  const outside = calls.filter(({ url }) => !url.startsWith(API)).map(({ url }) => url);
  assert.deepEqual(outside, [
    "https://mlb-app.example-subdomain.workers.dev/health",
    "https://wnba-app.example-subdomain.workers.dev/health",
  ]);
  assert.deepEqual(lines.slice(-2), ["health check: ok", "worker check: ok"]);
});

test("a service an app reports as down, or at another release, is put back, naming the app and never its address", async () => {
  for (const { report, problem } of [
    {
      report: { ok: false, release: null, problem: "its store doesn't answer" },
      problem: "mlb finds accounts not ok: its store doesn't answer",
    },
    {
      report: { ok: true, release: "1111111" },
      problem: "mlb reaches accounts at 1111111, not 2222222",
    },
  ]) {
    const { result, calls } = await deployWorker(answerHealth(report));
    assert.ok(result instanceof Error);
    assert.match(result.message, new RegExp(problem));
    assert.match(result.message, /the earlier version is live again/);
    assert.doesNotMatch(result.message, /workers\.dev|example-subdomain/);
    const putBack = calls.filter(
      ({ url, init }) => url.endsWith("/deployments") && init.method === "POST",
    );
    assert.equal(putBack.length, 1);
  }
});

test("a service no app reports yet, as on its first deploy, deploys with a notice", async () => {
  const { result, lines } = await deployWorker(answerHealth(null));
  assert.equal(result, "accounts");
  assert.deepEqual(lines.slice(-2), [
    "::notice::health check: skipped, no app reaches accounts yet",
    "worker check: ok",
  ]);
});

test("an app whose own health fails still vouches for the service it reaches", async () => {
  const { result, lines } = await deployWorker(answerHealth(RELEASED, { appStatus: 503 }));
  assert.equal(result, "accounts");
  assert.ok(lines.includes("health check: ok"));
});

test("an app uploads a binding to each service by its name, to its Worker on the app's channel", async () => {
  for (const [channel, service] of [
    ["production", "accounts"],
    ["beta", "accounts-beta"],
  ]) {
    const { calls } = await deployWorker(answerHealth(null), { worker: "mlb", channel });
    const upload = calls.find(({ init }) => init.method === "PUT");
    const metadata = JSON.parse(await upload.init.body.get("metadata").text());
    assert.deepEqual(
      metadata.bindings.at(-1),
      { type: "service", name: "ACCOUNTS", service },
      channel,
    );
  }
});

test("every service deploys before any app starts, and one that fails holds back no other", async () => {
  const events = [];
  const errors = [];
  const isDeployed = await deployWorkers(
    ["accounts", "mlb", "wnba"],
    async (worker) => {
      events.push(`start ${worker}`);
      await skipPause();
      events.push(`end ${worker}`);
      if (worker === "accounts") throw new Error("refused");
    },
    { logError: (line) => errors.push(line), isServiceWorker: (worker) => worker === "accounts" },
  );
  assert.equal(isDeployed, false);
  assert.deepEqual(events.slice(0, 2), ["start accounts", "end accounts"]);
  assert.deepEqual(
    events
      .slice(2)
      .filter((event) => event.startsWith("start"))
      .sort(),
    ["start mlb", "start wnba"],
  );
  assert.deepEqual(errors, ["accounts: refused"]);
});
