import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { nameServiceBinding } from "../shared/worker/services.js";
import { checkAppPage } from "../worker/check-page.mjs";
import { listApps, listServices } from "../worker/apps.mjs";
import { readRepoFile } from "./repo-files.js";
import { readStepScript } from "./workflow-step.js";

async function loadDeployModule() {
  const module = await import("../worker/deploy.mjs");
  return {
    ...module,
    /** @param {import("../worker/deploy.mjs").WorkerDeploymentOptions} options */
    deploy: (options) =>
      module.deploy({ checkPage: async () => ({ status: "drawn" }), ...options }),
  };
}
const ENV = {
  CLOUDFLARE_ACCOUNT_ID: "acct123",
  CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain",
  MLB_PAGE_URL: "https://mlb-app.example-subdomain.workers.dev/k3y/",
  MLB_BETA_PAGE_URL: "https://mlb-app-beta.example-subdomain.workers.dev/k3y/",
  WNBA_PAGE_URL: "https://wnba-app.example-subdomain.workers.dev/k3y/",
  WNBA_BETA_PAGE_URL: "https://wnba-app-beta.example-subdomain.workers.dev/k3y/",
  ACCESS_CODE: "LAYUP",
};

const API = "https://api.cloudflare.com/client/v4";
const WORKER_URL = "https://mlb-app.example-subdomain.workers.dev/";
const ROBOTS_URL = `${WORKER_URL}robots.txt`;
const LIVE_VERSIONS = [{ version_id: "v-live", percentage: 100 }];
const LIVE_DEPLOYMENTS = [
  { created_on: "2026-09-24T10:00:00Z", versions: [{ version_id: "v-older", percentage: 100 }] },
  { created_on: "2026-09-25T10:00:00Z", versions: LIVE_VERSIONS },
];
const LIVE_COMMIT = "1".repeat(40);
const NEW_COMMIT = "2".repeat(40);
// The Worker names the commit it was built from, as the build writes it: in short form.
const answerRobotsFrom = (commit) => () =>
  new Response("User-agent: *\nDisallow: /\n", {
    headers: { "x-release-commit": commit.slice(0, 7) },
  });
const ANSWER_ROBOTS = answerRobotsFrom(NEW_COMMIT);
const skipPause = async () => {};

/**
 * @param {{ refuse?: string, isNew?: boolean, answerWorker?: () => Response, refuseRollback?: boolean, migrationTag?: string, liveCommit?: string }} [options]
 */
function createFakeCloudflare({
  refuse,
  isNew = false,
  answerWorker = ANSWER_ROBOTS,
  refuseRollback = false,
  migrationTag,
  liveCommit,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (!url.startsWith(API)) return answerWorker();
    const isDeployments = url.endsWith("/deployments");
    // A token limited to its channel's Workers is refused the account's workers.dev subdomain.
    const isRefused =
      url.endsWith("/workers/subdomain") ||
      (refuse && url.includes(refuse)) ||
      (refuseRollback && isDeployments && init.method === "POST");
    if (isRefused) {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
        }),
        { status: 403 },
      );
    }
    if (isNew && isDeployments && init.method === "GET") {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10007, message: "This Worker does not exist on your account." }],
        }),
        { status: 404 },
      );
    }
    let result = {};
    if (url.endsWith("/workers/scripts"))
      result = isNew ? [] : [{ id: "mlb-app", migration_tag: migrationTag }];
    if (isDeployments && init.method === "GET") result = { deployments: LIVE_DEPLOYMENTS };
    if (url.endsWith("/versions/v-live"))
      result = { id: "v-live", annotations: liveCommit ? { "workers/message": liveCommit } : {} };
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}

const describeCalls = (calls) =>
  calls.map((request) => `${request.init.method} ${request.url.replace(API, "")}`);

test("the name, compatibility date, and store class come from wrangler.toml", async () => {
  const { loadWorkerConfig, readWorkerConfig } = await loadDeployModule();
  assert.deepEqual(loadWorkerConfig("mlb"), {
    name: "mlb-app",
    compatibilityDate: "2026-09-01",
    storeClass: "SeasonStore",
  });
  assert.throws(() => readWorkerConfig('name = "x"'), /compatibility_date/);
});

test("the beta channel's Worker is named by its environment, with the top level's date", async () => {
  const { loadWorkerConfig, readWorkerConfig } = await loadDeployModule();
  for (const app of listApps())
    assert.deepEqual(loadWorkerConfig(app, "beta"), {
      name: `${app}-app-beta`,
      compatibilityDate: "2026-09-01",
      storeClass: "SeasonStore",
    });
  const toml =
    'name = "x"\ncompatibility_date = "2026-09-01"\n\n[[durable_objects.bindings]]\nclass_name = "Store"\n';
  assert.deepEqual(readWorkerConfig(toml), {
    name: "x",
    compatibilityDate: "2026-09-01",
    storeClass: "Store",
  });
  assert.throws(
    () => readWorkerConfig('name = "x"\ncompatibility_date = "2026-09-01"\n'),
    /class_name/,
  );
  assert.throws(() => readWorkerConfig(toml, "beta"), /\[env\.beta\] with a name/);
  assert.throws(() => readWorkerConfig(toml, "staging"), /no channel named staging/);
});

test("a beta deploy uploads to the beta Worker, with the same bindings", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ isNew: true });
  const url = await deploy({
    worker: "mlb",
    channel: "beta",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "export default {}",
    commit: NEW_COMMIT,
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, "https://mlb-app-beta.example-subdomain.workers.dev/");
  const apiCalls = describeCalls(cloudflare.calls).filter((call) => call.includes("/scripts/"));
  assert.ok(
    apiCalls.every((call) => call.includes("/scripts/mlb-app-beta")),
    apiCalls.join("\n"),
  );
  const upload = cloudflare.calls.find((call) => call.init.method === "PUT");
  const metadata = JSON.parse(await upload.init.body.get("metadata").text());
  assert.deepEqual(
    metadata.bindings.map((binding) => binding.name),
    ["STORE", "ACCESS_LIMIT", "ACCOUNTS"],
  );
  assert.deepEqual(metadata.bindings[2], {
    type: "service",
    name: "ACCOUNTS",
    service: "accounts-beta",
  });
  assert.deepEqual(metadata.migrations.new_tag, "v1");
});

test("upload, route, and the Worker URL", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare();
  const url = await deploy({
    worker: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "export default {}",
    commit: NEW_COMMIT,
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, WORKER_URL);
  assert.deepEqual(describeCalls(cloudflare.calls), [
    "GET /accounts/acct123/workers/scripts/mlb-app/deployments",
    "GET /accounts/acct123/workers/scripts/mlb-app/versions/v-live",
    "GET /accounts/acct123/workers/scripts",
    "PUT /accounts/acct123/workers/scripts/mlb-app",
    "POST /accounts/acct123/workers/scripts/mlb-app/subdomain",
    `GET ${ROBOTS_URL}`,
  ]);

  const apiCalls = cloudflare.calls.filter((request) => request.url.startsWith(API));
  assert.ok(apiCalls.every((request) => request.init.signal instanceof AbortSignal));

  const form = cloudflare.calls[3].init.body;
  const metadata = JSON.parse(await form.get("metadata").text());
  assert.deepEqual(metadata, {
    main_module: "worker.mjs",
    compatibility_date: "2026-09-01",
    observability: { enabled: true, traces: { enabled: true } },
    bindings: [
      { type: "durable_object_namespace", name: "STORE", class_name: "SeasonStore" },
      {
        type: "ratelimit",
        name: "ACCESS_LIMIT",
        namespace_id: "2701",
        simple: { limit: 10, period: 60 },
      },
      { type: "service", name: "ACCOUNTS", service: "accounts" },
    ],
    keep_bindings: ["secret_text"],
    annotations: { "workers/message": NEW_COMMIT, "workers/tag": NEW_COMMIT.slice(0, 7) },
    migrations: { new_tag: "v1", steps: [{ new_sqlite_classes: ["SeasonStore"] }] },
  });
  const file = form.get("worker.mjs");
  assert.equal(file.type, "application/javascript+module");
  assert.equal(await file.text(), "export default {}");
  assert.deepEqual(JSON.parse(cloudflare.calls[4].init.body), {
    enabled: true,
    previews_enabled: false,
  });
});

test("nothing is uploaded when nothing the Worker runs changed since the live version", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ liveCommit: LIVE_COMMIT });
  const asked = [];
  const lines = [];
  const url = await deploy({
    worker: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    commit: NEW_COMMIT,
    findChanges: (since) => {
      asked.push(since);
      return ["README.md", "apps/mlb/tests/store.test.js"];
    },
    log: (line) => lines.push(line),
    pause: skipPause,
  });
  assert.equal(url, null);
  assert.deepEqual(asked, [LIVE_COMMIT]);
  assert.ok(!describeCalls(cloudflare.calls).some((call) => call.startsWith("PUT ")));
  assert.match(lines.at(-1), /Nothing the Worker runs changed since the live version/);
});

test("every change since the live version counts, not just the last merge's", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ liveCommit: LIVE_COMMIT });
  const url = await deploy({
    worker: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    commit: NEW_COMMIT,
    findChanges: () => ["apps/mlb/worker/src/store.js", "README.md"],
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, WORKER_URL);
  assert.ok(
    describeCalls(cloudflare.calls).includes("PUT /accounts/acct123/workers/scripts/mlb-app"),
  );
});

test("a live version with no recorded commit, or changes that can't be listed, deploy", async () => {
  const { deploy } = await loadDeployModule();
  /** @param {string | undefined} liveCommit @param {string[] | null} changes */
  const deployWith = (liveCommit, changes) =>
    deploy({
      worker: "mlb",
      fetchImpl: createFakeCloudflare({ liveCommit }).fetchImpl,
      env: ENV,
      script: "",
      commit: NEW_COMMIT,
      findChanges: () => changes,
      log: () => {},
      pause: skipPause,
    });
  assert.equal(await deployWith(undefined, []), WORKER_URL);
  assert.equal(await deployWith(LIVE_COMMIT, null), WORKER_URL);
});

test("a migration already applied isn't sent again", async () => {
  const { deploy, listPendingMigrations } = await loadDeployModule();
  assert.equal(listPendingMigrations("v1", "SeasonStore"), null);
  assert.deepEqual(listPendingMigrations(undefined, "SeasonStore"), {
    old_tag: undefined,
    new_tag: "v1",
    steps: [{ new_sqlite_classes: ["SeasonStore"] }],
  });

  const cloudflare = createFakeCloudflare({ migrationTag: "v1" });
  await deploy({
    worker: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    log: () => {},
    pause: skipPause,
  });
  const metadata = JSON.parse(await cloudflare.calls[3].init.body.get("metadata").text());
  assert.equal(metadata.migrations, undefined);
});

test("each app's wrangler.toml declares the same bindings and migrations", async () => {
  const { listMigrations } = await loadDeployModule();
  for (const app of listApps()) {
    const toml = readRepoFile(`apps/${app}/worker/wrangler.toml`);
    assert.match(
      toml,
      /\[\[durable_objects\.bindings\]\]\nname = "STORE"\nclass_name = "SeasonStore"/,
    );
    assert.match(
      toml,
      /\[\[ratelimits\]\]\nname = "ACCESS_LIMIT"\nnamespace_id = "2701"\n\n\[ratelimits\.simple\]\nlimit = 10\nperiod = 60/,
    );
    assert.match(
      toml,
      /\[\[env\.beta\.durable_objects\.bindings\]\]\nname = "STORE"\nclass_name = "SeasonStore"/,
    );
    assert.match(
      toml,
      /\[\[env\.beta\.ratelimits\]\]\nname = "ACCESS_LIMIT"\nnamespace_id = "2701"\n\n\[env\.beta\.ratelimits\.simple\]\nlimit = 10\nperiod = 60/,
    );
    for (const { tag, new_sqlite_classes: classes } of listMigrations("SeasonStore")) {
      const declared = `[[migrations]]\ntag = "${tag}"\nnew_sqlite_classes = ${JSON.stringify(classes)}`;
      assert.ok(toml.includes(declared), declared);
    }
    for (const service of listServices()) {
      const binding = nameServiceBinding(service);
      for (const [table, name] of [
        ["services", service],
        ["env.beta.services", `${service}-beta`],
      ]) {
        const declared = `[[${table}]]\nbinding = "${binding}"\nservice = "${name}"`;
        assert.ok(toml.includes(declared), declared);
      }
    }
  }
});

test("each service's wrangler.toml declares the bindings and migrations the deploy does", async () => {
  const { listMigrations } = await loadDeployModule();
  for (const service of listServices()) {
    const toml = readRepoFile(`services/${service}/worker/wrangler.toml`);
    const className = toml.match(/^class_name = "(\w+)"/m)?.[1];
    assert.ok(className, service);
    assert.match(toml.split("[env.beta]")[0], /^workers_dev = false\n/m);
    for (const prefix of ["", "env.beta."]) {
      assert.ok(
        toml.includes(
          `[[${prefix}durable_objects.bindings]]\nname = "STORE"\nclass_name = "${className}"`,
        ),
        `${service} ${prefix}STORE`,
      );
      assert.ok(
        toml.includes(`[${prefix}version_metadata]\nbinding = "VERSION"`),
        `${service} ${prefix}VERSION`,
      );
    }
    assert.match(toml, /\[env\.beta\]\nname = "[\w-]+-beta"\nworkers_dev = false/);
    for (const { tag, new_sqlite_classes: classes } of listMigrations(className)) {
      const declared = `[[migrations]]\ntag = "${tag}"\nnew_sqlite_classes = ${JSON.stringify(classes)}`;
      assert.ok(toml.includes(declared), declared);
    }
  }
});

test("a token is sent only when one is in the environment", async () => {
  const { deploy } = await loadDeployModule();
  // In a cloud session the proxy adds the token; the script must not send its own.
  const proxied = createFakeCloudflare();
  await deploy({
    worker: "mlb",
    fetchImpl: proxied.fetchImpl,
    env: ENV,
    script: "",
    log: () => {},
    pause: skipPause,
  });
  assert.ok(proxied.calls.every((request) => !request.init.headers?.authorization));

  const local = createFakeCloudflare();
  await deploy({
    worker: "mlb",
    fetchImpl: local.fetchImpl,
    env: { ...ENV, CLOUDFLARE_API_TOKEN: "t0k" },
    script: "",
    log: () => {},
    pause: skipPause,
  });
  const [workerCheck, ...cloudflareCalls] = local.calls.toReversed();
  assert.ok(
    cloudflareCalls.every((request) => request.init.headers.authorization === "Bearer t0k"),
  );
  assert.equal(workerCheck.url, ROBOTS_URL);
  assert.equal(workerCheck.init.headers, undefined, "the token stays with Cloudflare");
});

test("a refusal names the step and Cloudflare's reason; no account ID is caught first", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ refuse: "/scripts/mlb-app/subdomain" });
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /workers\.dev route failed: 10000: Authentication error/,
  );
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: {},
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /CLOUDFLARE_ACCOUNT_ID/,
  );
});

test("the workers.dev subdomain comes from its secret, checked before anything is sent", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare();
  const missing = /Set CLOUDFLARE_WORKERS_SUBDOMAIN/;
  const tooMuch = /just the part before \.workers\.dev/;
  for (const { subdomain, reason } of [
    { subdomain: undefined, reason: missing },
    { subdomain: "", reason: missing },
    { subdomain: "example-subdomain.workers.dev", reason: tooMuch },
    { subdomain: "https://example-subdomain", reason: tooMuch },
  ]) {
    const failure = await deploy({
      worker: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: { ...ENV, CLOUDFLARE_WORKERS_SUBDOMAIN: subdomain },
      script: "",
      log: () => {},
      pause: skipPause,
    }).catch((error) => error);
    assert.match(failure.message, reason);
    assert.doesNotMatch(failure.message, /example-subdomain/);
  }
  assert.deepEqual(cloudflare.calls, []);
});

test("the deploy step passes each Cloudflare secret the deploy reads", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  for (const secret of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_WORKERS_SUBDOMAIN",
  ])
    assert.ok(workflow.includes(`${secret}: \${{ secrets.${secret} }}`), secret);
});

test("a refusal that isn't Cloudflare's shows its status, server, and raw body", async () => {
  const { deploy } = await loadDeployModule();
  const refuseAsProxy = async () =>
    new Response("Forbidden by policy\n", { status: 403, headers: { server: "envoy" } });
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: refuseAsProxy,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /^Error: live version failed: HTTP 403 \(server: envoy\): Forbidden by policy$/,
  );
  const answerEmpty = async () => new Response("", { status: 502 });
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: answerEmpty,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /^Error: live version failed: HTTP 502$/,
  );
});

test("a request that carried no token says why, unless the script sent one itself", async () => {
  const { deploy } = await loadDeployModule();
  const refuseWithoutToken = async () =>
    new Response(
      JSON.stringify({
        success: false,
        errors: [
          { code: 9106, message: "Missing X-Auth-Key, X-Auth-Email or Authorization headers" },
        ],
      }),
      { status: 400 },
    );
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: refuseWithoutToken,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    (/** @type {Error} */ error) =>
      /live version failed: 9106/.test(error.message) &&
      /No token reached Cloudflare/.test(error.message) &&
      /NODE_USE_ENV_PROXY=1/.test(error.message),
  );
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: refuseWithoutToken,
      env: { ...ENV, CLOUDFLARE_API_TOKEN: "t0k" },
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    (/** @type {Error} */ error) =>
      /live version failed: 9106/.test(error.message) && !/No token reached/.test(error.message),
  );
  const cloudflare = createFakeCloudflare({ refuse: "/scripts/mlb-app" });
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    (/** @type {Error} */ error) =>
      /Authentication error/.test(error.message) && !/No token reached/.test(error.message),
  );
});

test("a first deploy has no live version to look up", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ isNew: true });
  const url = await deploy({
    worker: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, WORKER_URL);
});

test("the log and errors never show the Worker's address", async () => {
  const { deploy } = await loadDeployModule();
  const lines = [];
  const logLine = (line) => lines.push(line);
  await deploy({
    worker: "mlb",
    fetchImpl: createFakeCloudflare().fetchImpl,
    env: ENV,
    script: "",
    log: logLine,
    pause: skipPause,
  });
  const silent = createFakeCloudflare({ answerWorker: () => new Response("", { status: 500 }) });
  const failure = await deploy({
    worker: "mlb",
    fetchImpl: silent.fetchImpl,
    env: ENV,
    script: "",
    log: logLine,
    pause: skipPause,
  }).catch((error) => error);
  lines.push(failure.message);
  assert.ok(lines.includes("worker check: ok"));
  assert.match(failure.message, /the earlier version is live again/);
  assert.deepEqual(
    lines.filter((line) => line.includes("example-subdomain")),
    [],
  );
});

test("a Worker that doesn't answer puts the live version back", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({
    answerWorker: () => new Response("Worker threw exception", { status: 500 }),
  });
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /didn't answer as the new version, so the earlier version is live again/,
  );
  const calls = describeCalls(cloudflare.calls);
  assert.equal(calls.filter((call) => call === `GET ${ROBOTS_URL}`).length, 12);
  assert.equal(calls.at(-1), "POST /accounts/acct123/workers/scripts/mlb-app/deployments");
  assert.deepEqual(JSON.parse(cloudflare.calls.at(-1).init.body), {
    strategy: "percentage",
    versions: LIVE_VERSIONS,
  });
});

test("a Worker still answering as the version before isn't the new one, and is put back", async () => {
  const { deploy } = await loadDeployModule();
  const deployWhileAnswering = (answerWorker) =>
    deploy({
      worker: "mlb",
      fetchImpl: createFakeCloudflare({ liveCommit: LIVE_COMMIT, answerWorker }).fetchImpl,
      env: ENV,
      script: "",
      commit: NEW_COMMIT,
      findChanges: () => ["apps/mlb/page/js/app.js"],
      log: () => {},
      pause: skipPause,
    });

  await assert.rejects(
    deployWhileAnswering(answerRobotsFrom(LIVE_COMMIT)),
    /didn't answer as the new version, so the earlier version is live again/,
  );
  let checks = 0;
  const catchingUp = () => (++checks < 3 ? answerRobotsFrom(LIVE_COMMIT) : ANSWER_ROBOTS)();
  assert.equal(await deployWhileAnswering(catchingUp), WORKER_URL);
  assert.equal(checks, 3);
});

test("a new version's page that doesn't draw puts the live version back", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ liveCommit: LIVE_COMMIT });
  const checked = [];
  await assert.rejects(
    deploy({
      worker: "mlb",
      channel: "beta",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      commit: NEW_COMMIT,
      findChanges: () => ["apps/mlb/page/js/app.js"],
      log: () => {},
      pause: skipPause,
      checkPage: async (options) => {
        checked.push(options);
        return { status: "broken", reason: "the page threw: season is undefined" };
      },
    }),
    /The page didn't draw as the new version: the page threw: season is undefined, so the earlier version is live again/,
  );
  assert.deepEqual(checked, [{ app: "mlb", channel: "beta", commit: NEW_COMMIT, env: ENV }]);
  assert.equal(
    describeCalls(cloudflare.calls).at(-1),
    "POST /accounts/acct123/workers/scripts/mlb-app-beta/deployments",
  );
});

test("a thrown page check leaves the upload live but unverified, without exposing its error", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ liveCommit: LIVE_COMMIT });
  const lines = [];
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      commit: NEW_COMMIT,
      findChanges: () => ["apps/mlb/page/js/app.js"],
      log: (line) => lines.push(line),
      pause: skipPause,
      checkPage: async () => {
        throw new Error(`Target closed at ${ENV.MLB_PAGE_URL} with ${ENV.ACCESS_CODE}`);
      },
    }),
    /^Error: The new version is live but unverified: the page check failed\.$/,
  );
  assert.ok(
    !describeCalls(cloudflare.calls).some(
      (call) => call.startsWith("POST ") && call.endsWith("/deployments"),
    ),
  );
  assert.ok(!lines.some((line) => /worker check: ok|page check: ok|LAYUP|k3y/.test(line)));
});

/**
 * @param {"context" | "browser"} cleanup
 * @param {"broken response" | "wrong release" | "drawn"} result
 */
function createCleanupFailureBrowser(cleanup, result) {
  const page = {
    on: () => {},
    goto: async () => ({ ok: () => result !== "broken response", status: () => 500 }),
    url: () => ENV.MLB_PAGE_URL,
    evaluate: async () => 204,
    locator: () => ({
      evaluateAll: async () => [
        `${ENV.MLB_PAGE_URL}release/${(result === "wrong release" ? LIVE_COMMIT : NEW_COMMIT).slice(0, 7)}/js/app.js`,
      ],
    }),
    waitForFunction: async () => {},
  };
  const closed = [];
  const closeResource = async (name) => {
    closed.push(name);
    if (name === cleanup) throw new Error("Target closed during cleanup");
  };
  const context = { newPage: async () => page, close: () => closeResource("context") };
  const browser = { newContext: async () => context, close: () => closeResource("browser") };
  return {
    browser: /** @type {import("@playwright/test").Browser} */ (/** @type {unknown} */ (browser)),
    closed,
  };
}

test("confirmed broken pages and wrong releases still roll back when browser cleanup fails", async () => {
  const { deploy } = await loadDeployModule();
  for (const cleanup of /** @type {const} */ (["context", "browser"])) {
    for (const result of /** @type {const} */ (["broken response", "wrong release"])) {
      const { browser, closed } = createCleanupFailureBrowser(cleanup, result);
      const cloudflare = createFakeCloudflare();
      const lines = [];
      await assert.rejects(
        deploy({
          worker: "mlb",
          fetchImpl: cloudflare.fetchImpl,
          env: ENV,
          script: "",
          commit: NEW_COMMIT,
          log: (line) => lines.push(line),
          pause: skipPause,
          checkPage: (options) =>
            checkAppPage({ ...options, pauseMs: 0, launchBrowser: async () => browser }),
        }),
        /The page didn't draw as the new version: .*so the earlier version is live again/,
      );
      assert.equal(
        describeCalls(cloudflare.calls).at(-1),
        "POST /accounts/acct123/workers/scripts/mlb-app/deployments",
      );
      assert.ok(closed.includes("context"));
      assert.equal(closed.at(-1), "browser");
      assert.ok(!lines.includes("worker check: ok"));
    }
  }
});

test("cleanup failures without a confirmed broken page remain unverified without rollback", async () => {
  const { deploy } = await loadDeployModule();
  for (const cleanup of /** @type {const} */ (["context", "browser"])) {
    const { browser, closed } = createCleanupFailureBrowser(cleanup, "drawn");
    const cloudflare = createFakeCloudflare();
    const lines = [];
    await assert.rejects(
      deploy({
        worker: "mlb",
        fetchImpl: cloudflare.fetchImpl,
        env: ENV,
        script: "",
        commit: NEW_COMMIT,
        log: (line) => lines.push(line),
        pause: skipPause,
        checkPage: (options) => checkAppPage({ ...options, launchBrowser: async () => browser }),
      }),
      /The new version is live but unverified: the page check failed/,
    );
    assert.ok(
      !describeCalls(cloudflare.calls).some(
        (call) => call.startsWith("POST ") && call.endsWith("/deployments"),
      ),
    );
    assert.equal(closed.at(-1), "browser");
    assert.ok(!lines.includes("worker check: ok"));
  }
});

test("a merge whose live version already has it isn't deployed, but a push to beta is", async () => {
  const { deploy } = await loadDeployModule();
  /** @type {string[][]} */
  const asked = [];
  /** @param {string} channel */
  const deployOlder = (channel) => {
    const cloudflare = createFakeCloudflare({ liveCommit: LIVE_COMMIT });
    const lines = [];
    const url = deploy({
      worker: "mlb",
      channel,
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      commit: NEW_COMMIT,
      findChanges: () => ["apps/mlb/page/js/app.js"],
      log: (line) => lines.push(line),
      pause: skipPause,
      checkPage: async () => ({ status: "drawn" }),
      isEarlier: (commit, of) => {
        asked.push([commit, of]);
        return true;
      },
    });
    return { url, lines, cloudflare };
  };

  const merge = deployOlder("production");
  assert.equal(await merge.url, null);
  assert.deepEqual(asked, [[NEW_COMMIT, LIVE_COMMIT]]);
  assert.match(
    merge.lines.at(-1),
    /^::notice::The live version is at 1111111, which already has 2222222, so nothing was deployed\.$/,
  );
  assert.ok(!describeCalls(merge.cloudflare.calls).some((call) => call.startsWith("PUT ")));

  const beta = deployOlder("beta");
  assert.equal(await beta.url, "https://mlb-app-beta.example-subdomain.workers.dev/");
  assert.equal(asked.length, 1);
});

test("a merge main has moved past deploys unless CI passed on the newer one, and beta's newer push always covers it", async () => {
  const { decideMovedOn } = await loadDeployModule();
  const release = { commit: LIVE_COMMIT, newer: NEW_COMMIT };
  /** @type {string[]} */
  const asked = [];
  /** @param {"passed" | "not passed" | "unknown"} state */
  const answerCi = (state) => async (/** @type {string} */ commit) => {
    asked.push(commit);
    return state;
  };

  assert.deepEqual(await decideMovedOn({ ...release, channel: "production" }, answerCi("passed")), {
    isCovered: true,
    message:
      "::notice::main has moved on to 2222222, whose deploy covers 1111111, so nothing was deployed.",
  });
  assert.deepEqual(asked, [NEW_COMMIT]);
  assert.deepEqual(
    await decideMovedOn({ ...release, channel: "production" }, answerCi("not passed")),
    {
      isCovered: false,
      message:
        "::notice::main has moved on to 2222222, but CI on main hasn't passed on it, so 1111111 deploys.",
    },
  );
  assert.deepEqual(
    await decideMovedOn({ ...release, channel: "production" }, answerCi("unknown")),
    {
      isCovered: false,
      message:
        "::notice::main has moved on to 2222222, but GitHub couldn't be asked whether CI on main passed on it, so 1111111 deploys.",
    },
  );
  const beta = await decideMovedOn({ ...release, channel: "beta" }, answerCi("not passed"));
  assert.equal(beta.isCovered, true);
  assert.equal(asked.length, 3, "beta asks nothing");
});

test("whether CI on main passed on a commit comes from its newest push run, and is unknown when GitHub can't be asked", async () => {
  const { readMainCiState } = await loadDeployModule();
  const env = { GH_TOKEN: "token", GITHUB_REPOSITORY: "owner/repo" };
  /** @type {string[]} */
  const urls = [];
  /** @param {Response} answer */
  const createFetch = (answer) => async (/** @type {string} */ url) => {
    urls.push(url);
    return answer;
  };
  /** @param {(string | null)[]} conclusions */
  const answerRuns = (conclusions) =>
    Response.json({ workflow_runs: conclusions.map((conclusion) => ({ conclusion })) });

  assert.equal(
    await readMainCiState(NEW_COMMIT, { fetchImpl: createFetch(answerRuns(["success"])), env }),
    "passed",
  );
  assert.deepEqual(urls, [
    `https://api.github.com/repos/owner/repo/actions/workflows/ci.yml/runs?head_sha=${NEW_COMMIT}&event=push&per_page=1`,
  ]);
  for (const answer of [answerRuns(["failure"]), answerRuns([null]), answerRuns([])])
    assert.equal(
      await readMainCiState(NEW_COMMIT, { fetchImpl: createFetch(answer), env }),
      "not passed",
    );
  assert.equal(
    await readMainCiState(NEW_COMMIT, {
      fetchImpl: createFetch(new Response("", { status: 500 })),
      env,
    }),
    "unknown",
  );
  for (const unnamed of [{}, { GH_TOKEN: "token" }, { GITHUB_REPOSITORY: "owner/repo" }])
    assert.equal(
      await readMainCiState(NEW_COMMIT, {
        fetchImpl: createFetch(answerRuns(["success"])),
        env: unnamed,
      }),
      "unknown",
    );
});

test("an authenticated drawing page verifies each app on each channel", async () => {
  const { deploy } = await loadDeployModule();
  for (const worker of listApps()) {
    for (const channel of ["production", "beta"]) {
      const lines = [];
      const url = await deploy({
        worker,
        channel,
        fetchImpl: createFakeCloudflare().fetchImpl,
        env: ENV,
        script: "",
        log: (line) => lines.push(line),
        pause: skipPause,
      });
      assert.equal(
        url,
        `https://${worker}-app${channel === "beta" ? "-beta" : ""}.example-subdomain.workers.dev/`,
      );
      assert.deepEqual(lines.slice(-2), ["page check: ok", "worker check: ok"]);
    }
  }
});

test("missing page URL or code fails after upload, leaving first and existing releases live but unverified", async () => {
  const { deploy } = await loadDeployModule();
  const { nameAccessSecrets } = await import("../worker/check-page.mjs");
  for (const worker of listApps()) {
    for (const channel of ["production", "beta"]) {
      for (const secret of Object.values(nameAccessSecrets(worker, channel))) {
        for (const isNew of [true, false]) {
          const env = { ...ENV, [secret]: "" };
          const cloudflare = createFakeCloudflare({ isNew });
          const lines = [];
          await assert.rejects(
            deploy({
              worker,
              channel,
              fetchImpl: cloudflare.fetchImpl,
              env,
              script: "",
              log: (line) => lines.push(line),
              pause: skipPause,
              checkPage: async () => {
                assert.fail(
                  "missing verification secrets must be identified before opening a browser",
                );
              },
            }),
            new RegExp(`The new version is live but unverified: no ${secret} secret`),
          );
          const calls = describeCalls(cloudflare.calls);
          assert.ok(
            calls.some((call) => call.startsWith("PUT ")),
            "the initial upload must still happen",
          );
          assert.ok(
            !calls.some((call) => call.startsWith("POST ") && call.endsWith("/deployments")),
          );
          assert.ok(!lines.some((line) => /worker check: ok|page check: ok/.test(line)));
        }
      }
    }
  }
});

test("unchecked or unauthenticated drawing pages fail verification without rollback", async () => {
  const { deploy } = await loadDeployModule();
  for (const check of [
    { status: "drawn", note: "the page asks for no code, so its access code secret isn't needed" },
    { status: "unchecked", reason: "the Worker refused the access code" },
    { status: "unchecked", reason: "the Worker had too many tries at the access code" },
    { status: "unchecked", reason: "no MLB_PAGE_URL secret" },
  ]) {
    const cloudflare = createFakeCloudflare();
    const lines = [];
    await assert.rejects(
      deploy({
        worker: "mlb",
        fetchImpl: cloudflare.fetchImpl,
        env: ENV,
        script: "",
        log: (line) => lines.push(line),
        pause: skipPause,
        checkPage: async () => /** @type {any} */ (check),
      }),
      /The new version is live but unverified:/,
    );
    assert.ok(
      !describeCalls(cloudflare.calls).some(
        (call) => call.startsWith("POST ") && call.endsWith("/deployments"),
      ),
    );
    assert.ok(!lines.some((line) => /worker check: ok|page check: ok/.test(line)));
  }
});

test("each deploy and each watch of the apps opens every app's page with its own secrets", async () => {
  const { nameAccessSecrets } = await import("../worker/check-page.mjs");
  const readWorkflow = (name) => readRepoFile(`.github/workflows/${name}`);
  const listPassed = (workflow, channel) =>
    listApps().flatMap((app) =>
      Object.values(nameAccessSecrets(app, channel)).filter(
        (secret) => !workflow.includes(`${secret}: \${{ secrets.${secret} }}`),
      ),
    );
  for (const channel of ["production", "beta"])
    assert.deepEqual(listPassed(readWorkflow("deploy.yml"), channel), [], channel);
  assert.deepEqual(listPassed(readWorkflow("watch.yml"), "production"), []);
});

test("each workflow passes one access code for every app, never one of an app's own", () => {
  for (const name of ["deploy.yml", "watch.yml"])
    assert.deepEqual(
      readRepoFile(`.github/workflows/${name}`).match(/\w+_ACCESS_CODE(?=:)/g),
      null,
      name,
    );
});

test("a failed check says so when there's nothing to go back to, or going back fails", async () => {
  const { deploy } = await loadDeployModule();
  const answerWorker = () => new Response("", { status: 404 });
  const brandNew = createFakeCloudflare({ isNew: true, answerWorker });
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: brandNew.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /didn't answer as the new version, and no earlier version exists/,
  );
  assert.ok(
    !describeCalls(brandNew.calls).some((call) =>
      call.startsWith("POST /accounts/acct123/workers/scripts/mlb-app/deployments"),
    ),
  );

  const stuck = createFakeCloudflare({ answerWorker, refuseRollback: true });
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: stuck.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /the new version is still live: rollback failed: 10000: Authentication error/,
  );
});

test("a first deploy waits minutes for its new address, and a redeploy doesn't", async () => {
  const { deploy } = await loadDeployModule();
  const deployAnsweringOnCheck = (isNew, answeringCheck) => {
    let checks = 0;
    const answerWorker = () =>
      ++checks < answeringCheck ? new Response("", { status: 404 }) : ANSWER_ROBOTS();
    const lines = [];
    const result = deploy({
      worker: "mlb",
      fetchImpl: createFakeCloudflare({ isNew, answerWorker }).fetchImpl,
      env: ENV,
      script: "",
      log: (line) => lines.push(line),
      pause: skipPause,
    });
    return { result, lines };
  };

  const firstDeploy = deployAnsweringOnCheck(true, 60);
  assert.equal(await firstDeploy.result, WORKER_URL);
  assert.ok(firstDeploy.lines.some((line) => /waiting for the new workers.dev address/.test(line)));
  await assert.rejects(
    deployAnsweringOnCheck(true, 61).result,
    /didn't answer as the new version, and no earlier version exists/,
  );

  const redeploy = deployAnsweringOnCheck(false, 13);
  await assert.rejects(
    redeploy.result,
    /didn't answer as the new version, so the earlier version is live again/,
  );
  assert.ok(!redeploy.lines.some((line) => /waiting for the new/.test(line)));
});

test("a step that fails after the upload puts the live version back", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ refuse: "/mlb-app/subdomain" });
  await assert.rejects(
    deploy({
      worker: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /workers.dev route failed: 10000: Authentication error, so the earlier version is live again/,
  );
  const calls = describeCalls(cloudflare.calls);
  assert.equal(calls.at(-1), "POST /accounts/acct123/workers/scripts/mlb-app/deployments");
  assert.deepEqual(JSON.parse(cloudflare.calls.at(-1).init.body).versions, LIVE_VERSIONS);
});

function createFakeGit({
  branch = "main",
  dirty = "",
  head = "a".repeat(40),
  origin = "a".repeat(40),
  isBehind = false,
} = {}) {
  const asked = [];
  const answerGitCommand = (args) => {
    asked.push(args.join(" "));
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return branch;
    if (args[0] === "status") return dirty;
    if (args[0] === "fetch") return "";
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? head : origin;
    if (args[0] === "merge-base") {
      if (isBehind) return "";
      throw new Error("not an ancestor");
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git: answerGitCommand, asked };
}

test("a release is clean and exactly what GitHub has as main, on any branch", async () => {
  const { checkRelease } = await loadDeployModule();
  const cleanMain = createFakeGit();
  const release = { commit: "a".repeat(40), newer: null };
  assert.deepEqual(checkRelease(cleanMain.git), release);
  assert.ok(
    cleanMain.asked.includes("fetch --quiet origin main"),
    "compares against a fresh fetch",
  );
  // A detached checkout reports its branch as HEAD.
  assert.deepEqual(checkRelease(createFakeGit({ branch: "claude/some-branch" }).git), release);
  assert.deepEqual(checkRelease(createFakeGit({ branch: "HEAD" }).git), release);
});

test("a merged commit that main has moved past names the newer main instead", async () => {
  const { checkRelease } = await loadDeployModule();
  const behind = createFakeGit({ branch: "HEAD", head: "b".repeat(40), isBehind: true });
  assert.deepEqual(checkRelease(behind.git), { commit: "b".repeat(40), newer: "a".repeat(40) });
  assert.ok(behind.asked.includes(`merge-base --is-ancestor ${"b".repeat(40)} ${"a".repeat(40)}`));
});

test("anything else is refused, with the reason", async () => {
  const { checkRelease } = await loadDeployModule();
  assert.throws(
    () => checkRelease(createFakeGit({ dirty: " M page/js/snapshot.js" }).git),
    /uncommitted changes/,
  );
  assert.throws(
    () => checkRelease(createFakeGit({ head: "b".repeat(40) }).git),
    /isn't main as GitHub has it/,
  );
  assert.throws(
    () => checkRelease(createFakeGit({ branch: "claude/some-branch", head: "b".repeat(40) }).git),
    /claude\/some-branch at bbbbbbb\) isn't main as GitHub has it \(aaaaaaa\)/,
  );
});

test("a beta release is what GitHub has as beta, and a push beta has since replaced, built on or not, is older", async () => {
  const { checkRelease } = await loadDeployModule();
  const fake = createFakeGit({ branch: "claude/some-branch" });
  assert.deepEqual(checkRelease(fake.git, "beta", ""), { commit: "a".repeat(40), newer: null });
  assert.ok(fake.asked.includes("fetch --quiet origin beta"));
  assert.ok(fake.asked.includes("rev-parse origin/beta"));
  const forcePushedOver = createFakeGit({ branch: "HEAD", head: "b".repeat(40) });
  assert.deepEqual(checkRelease(forcePushedOver.git, "beta", "b".repeat(40)), {
    commit: "b".repeat(40),
    newer: "a".repeat(40),
  });
});

test("a checkout at a commit beta never held isn't a beta release, and sends a session to the steps that claim beta", async () => {
  const { checkRelease } = await loadDeployModule();
  for (const pushedCommit of ["", "c".repeat(40)])
    assert.throws(
      () =>
        checkRelease(
          createFakeGit({ branch: "claude/some-branch", head: "b".repeat(40) }).git,
          "beta",
          pushedCommit,
        ),
      (/** @type {Error} */ error) => {
        assert.match(
          error.message,
          /claude\/some-branch at bbbbbbb\) isn't beta as GitHub has it \(aaaaaaa\)\. Put it on beta by the ship skill's "The beta channel" \(\.claude\/skills\/ship\/SKILL\.md\), which claims beta first, or check out origin\/beta/,
        );
        assert.doesNotMatch(error.message, /git push/);
        return true;
      },
    );
});

test("a push to beta deploys the beta channel, and main still waits for its CI", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  assert.match(workflow, /push:\n {4}branches: \[main, beta\]/);
  assert.match(
    workflow,
    /CHANNEL: \$\{\{ github\.ref_name == 'beta' && 'beta' \|\| 'production' \}\}/,
  );
  assert.match(workflow, /group: deploy-\$\{\{ github\.ref_name \}\}/);
  // A push to beta runs that branch's own scripts, so it gets beta's environment and token.
  assert.match(
    workflow,
    /environment: \$\{\{ github\.ref_name == 'beta' && 'beta' \|\| 'production' \}\}/,
  );
  assert.match(workflow, /No CLOUDFLARE_API_TOKEN in the \$CHANNEL environment/);
  assert.match(workflow, /if: github\.event_name == 'push' && env\.CHANNEL == 'production'\n/);
});

test("deploy:api runs the tests before it deploys, and sends its calls through any proxy", () => {
  const scripts = JSON.parse(readRepoFile("package.json")).scripts;
  assert.equal(scripts["deploy:api"], "npm test && NODE_USE_ENV_PROXY=1 node worker/deploy.mjs");
});

test("a missing channel token fails the deploy step before invoking the deploy", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  const laterStep = "      - name: Unrelated later step\n        run: exit 9\n";
  const script = readStepScript(`${workflow}${laterStep}`, "Deploy the Worker");
  for (const channel of ["production", "beta"])
    for (const token of ["", "test-token"]) {
      const result = spawnSync(
        "bash",
        ["-e", "-c", `node() { printf 'DEPLOY CALLED: %s\\n' "$*"; }\n${script}`],
        {
          env: { PATH: process.env.PATH, CHANNEL: channel, CLOUDFLARE_API_TOKEN: token },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, token ? 0 : 1, result.stderr);
      if (token) assert.match(result.stdout, new RegExp(`DEPLOY CALLED:.*--channel ${channel}`));
      else {
        assert.match(
          result.stdout,
          new RegExp(`::error::No CLOUDFLARE_API_TOKEN in the ${channel}`),
        );
        assert.doesNotMatch(result.stdout, /DEPLOY CALLED/);
      }
      assert.doesNotMatch(result.stdout, /test-token/);
    }
});

test("the deploy job runs no package's install scripts or tests while it holds the token", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  assert.match(workflow, /- run: npm ci --ignore-scripts\n/);
  assert.match(workflow, /\n {10}node worker\/deploy\.mjs --channel "\$CHANNEL"\n/);
  assert.doesNotMatch(workflow, /npm run deploy:api|npm test/);
  assert.match(workflow, /timeout-minutes: \d+/);
});

test("project settings ask before each change to a live Worker but beta's, and deny making it any other way", () => {
  const { permissions } = JSON.parse(readRepoFile(".claude/settings.json"));
  // A message to another of the owner's sessions changes nothing outside them, so a session a
  // session started reports to it without asking. A session opens an issue for a finding or bug it
  // leaves out of a PR in the same turn, which a prompt it can't answer would lose. A session
  // claims beta, and waits in line for it, by adding and taking off one label at a time.
  assert.deepEqual(permissions.allow, [
    "Bash(git push -f origin *:beta)",
    "Bash(gh issue create *)",
    "Bash(gh issue comment *)",
    "Bash(gh issue close *)",
    "Bash(gh pr list --label beta --state open)",
    "Bash(gh pr list --label beta-wait --state open)",
    "Bash(gh pr edit * --add-label beta)",
    "Bash(gh pr edit * --remove-label beta)",
    "Bash(gh pr edit * --add-label beta-wait)",
    "Bash(gh pr edit * --remove-label beta-wait)",
    "mcp__github__add_issue_comment",
    "mcp__github__issue_write",
    "mcp__claude-code-remote__send_message",
  ]);
  for (const rule of [
    "Bash(npm run deploy)",
    "Bash(npx wrangler *)",
    "Bash(wrangler *)",
    // A branch's name has no spaces, so this keeps the beta push from naming any other branch too.
    "Bash(git push -f origin * *:beta)",
    // Deny extra arguments and a flag in the PR number's place, including an omitted number.
    "Bash(gh pr edit * * --add-label beta)",
    "Bash(gh pr edit * * --remove-label beta)",
    "Bash(gh pr edit * * --add-label beta-wait)",
    "Bash(gh pr edit * * --remove-label beta-wait)",
    "Bash(gh pr edit -* --add-label beta)",
    "Bash(gh pr edit -* --remove-label beta)",
    "Bash(gh pr edit -* --add-label beta-wait)",
    "Bash(gh pr edit -* --remove-label beta-wait)",
  ]) {
    assert.ok(permissions.deny.includes(rule), rule);
  }
  const scripts = Object.entries(JSON.parse(readRepoFile("package.json")).scripts);
  const liveScripts = scripts.flatMap(([name, command]) => {
    const [, file] = command.match(/NODE_USE_ENV_PROXY=1 node (worker\/[\w-]+\.mjs)/) ?? [];
    return file ? [{ name, file }] : [];
  });
  assert.ok(liveScripts.length > 1);
  // An ask rule prompts even in auto mode, so the owner approves each change a session makes.
  for (const { name, file } of liveScripts) {
    for (const rule of [`Bash(node ${file})`, `Bash(node ${file} *)`]) {
      assert.ok(permissions.deny.includes(rule), rule);
    }
    for (const rule of [`Bash(npm run ${name})`, `Bash(npm run ${name} *)`]) {
      assert.ok(permissions.ask.includes(rule), rule);
      assert.ok(!permissions.allow.includes(rule) && !permissions.deny.includes(rule), rule);
    }
  }
});

test(
  "every app deploys at once, and one that fails doesn't hold back the others",
  {
    timeout: 2000,
  },
  async () => {
    const { deployWorkers } = await loadDeployModule();
    const started = [];
    const errors = [];
    /** @type {(value?: unknown) => void} */
    let releaseMlb = () => {};
    const mlbHeld = new Promise((resolve) => (releaseMlb = resolve));
    const isDeployed = await deployWorkers(
      ["mlb", "wnba"],
      async (app) => {
        started.push(app);
        if (app === "mlb") {
          await mlbHeld;
          throw new Error("upload refused");
        }
        releaseMlb();
      },
      { logError: (line) => errors.push(line) },
    );
    assert.deepEqual(started, ["mlb", "wnba"]);
    assert.equal(isDeployed, false);
    assert.deepEqual(errors, ["mlb: upload refused"]);
  },
);
