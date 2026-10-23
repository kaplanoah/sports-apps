import test from "node:test";
import assert from "node:assert/strict";
import { deploy, deployRelease, deployWorkers } from "../worker/deploy.mjs";
import { createServiceRoots } from "./service-roots.js";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123", CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain" };
const API = "https://api.cloudflare.com/client/v4";
const NEW_COMMIT = "2".repeat(40);
const LIVE_COMMIT = "1".repeat(40);
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

/**
 * @param {object} [options]
 * @param {boolean} [options.isServiceChanged]
 * @param {boolean} [options.isServiceNew]
 * @param {boolean} [options.isAppOnly]
 * @param {boolean} [options.areAppsUnbound]
 * @param {boolean} [options.isRollbackRefused]
 * @param {boolean} [options.isLiveCommitMissing]
 * @param {boolean} [options.isAppBroken]
 * @param {string} [options.healthProblem]
 * @param {string} [options.reportedRelease]
 */
async function deployServiceAndApps({
  isServiceChanged = true,
  isServiceNew = false,
  isAppOnly = false,
  areAppsUnbound = false,
  isRollbackRefused = false,
  isLiveCommitMissing = false,
  isAppBroken = false,
  healthProblem,
  reportedRelease,
} = {}) {
  const { roots, remove } = createServiceRoots();
  const events = [];
  const errors = [];
  const lines = [];
  const calls = [];
  const boundApps = new Set();
  let serviceCommit = LIVE_COMMIT;
  const previousVersions = [
    { version_id: "v-live", percentage: 70 },
    { version_id: "v-older", percentage: 30 },
  ];
  let finishMlb;
  const mlbPage = new Promise((resolve) => (finishMlb = resolve));
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (!url.startsWith(API)) {
      if (url.endsWith("/robots.txt"))
        return new Response("", { headers: { "x-release-commit": NEW_COMMIT.slice(0, 7) } });
      const app = new URL(url).hostname.split("-")[0];
      events.push(`health ${app}`);
      const report = boundApps.has(app)
        ? {
            ok: !healthProblem,
            release: reportedRelease ?? serviceCommit.slice(0, 7),
            ...(healthProblem && { problem: healthProblem }),
          }
        : null;
      return answerHealth(report)();
    }
    const worker = url.match(/\/scripts\/([^/]+)/)?.[1];
    let result = {};
    if (url.endsWith("/deployments") && init.method === "GET")
      result = {
        deployments:
          worker === "accounts" && isServiceNew
            ? []
            : [{ ...LIVE_DEPLOYMENTS[0], versions: previousVersions }],
      };
    if (url.endsWith("/versions/v-live"))
      result = {
        annotations: isLiveCommitMissing ? {} : { "workers/message": LIVE_COMMIT },
      };
    if (url.endsWith("/workers/scripts"))
      result = ["accounts", "mlb-app", "wnba-app"].map((id) => ({ id, migration_tag: "v1" }));
    if (init.method === "PUT") {
      events.push(`upload ${worker}`);
      const metadataFile = /** @type {Blob} */ (
        /** @type {FormData} */ (init.body).get("metadata")
      );
      const metadata = JSON.parse(await metadataFile.text());
      if (worker === "accounts") serviceCommit = metadata.annotations["workers/message"];
      else if (!areAppsUnbound) boundApps.add(worker.split("-")[0]);
    }
    if (url.endsWith("/deployments") && init.method === "POST") {
      events.push(`rollback ${worker}`);
      if (isRollbackRefused && worker === "accounts")
        return new Response(
          JSON.stringify({ success: false, errors: [{ code: 10007, message: "refused" }] }),
        );
      if (worker === "accounts") serviceCommit = LIVE_COMMIT;
      else boundApps.delete(worker.split("-")[0]);
    }
    return new Response(JSON.stringify({ success: true, result }));
  };
  try {
    const workers = isAppOnly ? ["mlb", "wnba"] : ["accounts", "mlb", "wnba"];
    const isDeployed = await deployRelease(workers, {
      roots,
      commit: NEW_COMMIT,
      buildWorkerImpl: async () => "export default {}",
      deployWorkerImpl: (options) =>
        deploy({
          ...options,
          findChanges: () =>
            isServiceChanged
              ? ["shared/worker/services.js"]
              : ["apps/mlb/worker/index.js", "apps/wnba/worker/index.js"],
          fetchImpl,
          env: ENV,
          log: (line) => lines.push(`${options.worker}: ${line}`),
          pause: skipPause,
          isEarlier: () => false,
          checkPage: async ({ app }) => {
            if (app === "mlb") await mlbPage;
            else finishMlb();
            events.push(`page ${app}`);
            return isAppBroken && app === "wnba"
              ? { status: "broken", reason: "the page is empty" }
              : { status: "drawn" };
          },
        }),
      logError: (line) => errors.push(line),
    });
    return { isDeployed, events, errors, lines, calls, previousVersions };
  } finally {
    remove();
  }
}

test("an app-only release builds only its app and checks every service on its channel", async () => {
  const { roots, remove } = createServiceRoots();
  const events = [];
  const prepared = [];
  try {
    const isDeployed = await deployRelease(["mlb"], {
      channel: "beta",
      commit: NEW_COMMIT,
      roots,
      buildWorkerImpl: async (worker, { channel }) => {
        assert.equal(worker, "mlb", "a check-only service must not be built");
        assert.equal(channel, "beta");
        events.push(`build ${worker}`);
        return "export default {}";
      },
      deployWorkerImpl: async (options) => {
        prepared.push(options);
        events.push(`prepare ${options.worker}`);
        options.deferServiceCheck?.(async () => {
          events.push(`check ${options.worker}`);
        });
        return null;
      },
    });
    assert.equal(isDeployed, true);
    assert.deepEqual(events, ["prepare accounts", "build mlb", "prepare mlb", "check accounts"]);
    assert.deepEqual(
      prepared.map(({ worker, channel, script, isCheckOnly, commit }) => ({
        worker,
        channel,
        script,
        isCheckOnly,
        commit,
      })),
      [
        { worker: "accounts", channel: "beta", script: "", isCheckOnly: true, commit: NEW_COMMIT },
        {
          worker: "mlb",
          channel: "beta",
          script: "export default {}",
          isCheckOnly: undefined,
          commit: NEW_COMMIT,
        },
      ],
    );
  } finally {
    remove();
  }
});

test("a first service deploy is checked through newly bound apps after both pages settle", async () => {
  const { isDeployed, events, lines } = await deployServiceAndApps({ isServiceNew: true });
  assert.equal(isDeployed, true);
  assert.equal(events[0], "upload accounts");
  assert.deepEqual(events.slice(-2), ["health mlb", "health wnba"]);
  assert.ok(events.indexOf("page mlb") < events.indexOf("health mlb"));
  assert.ok(events.indexOf("page wnba") < events.indexOf("health mlb"));
  assert.ok(lines.includes("accounts: health check: ok"));
  assert.ok(!lines.some((line) => line.includes("skipped")));
});

test("a service found broken or at the wrong release after apps settle restores its original traffic split", async () => {
  for (const failure of [{ healthProblem: "store unavailable" }, { reportedRelease: "3333333" }]) {
    const { isDeployed, events, errors, calls, previousVersions } =
      await deployServiceAndApps(failure);
    assert.equal(isDeployed, false);
    assert.ok(events.indexOf("health mlb") > events.indexOf("page mlb"));
    assert.ok(events.indexOf("rollback accounts") > events.indexOf("health mlb"));
    assert.match(errors[0], /accounts: The service didn't answer as the new version/);
    assert.match(errors[0], /the earlier version is live again/);
    assert.doesNotMatch(errors[0], /workers\.dev|example-subdomain/);
    const rollback = calls.find(
      ({ url, init }) => url.endsWith("/accounts/deployments") && init.method === "POST",
    );
    assert.deepEqual(JSON.parse(rollback.init.body).versions, previousVersions);
  }
});

test("deferred service failures keep the no-earlier-version and refused-rollback guards", async () => {
  for (const { options, problem } of [
    { options: { isServiceNew: true }, problem: /no earlier version exists/ },
    {
      options: { isRollbackRefused: true },
      problem: /the new version is still live: rollback failed: 10007: refused/,
    },
  ]) {
    const { isDeployed, errors } = await deployServiceAndApps({
      ...options,
      healthProblem: "not ready",
    });
    assert.equal(isDeployed, false);
    assert.match(errors[0], problem);
  }
});

test("newly bound apps check an unchanged service at its own live commit without uploading it", async () => {
  for (const isAppOnly of [false, true]) {
    const { isDeployed, events, lines, calls } = await deployServiceAndApps({
      isAppOnly,
      isServiceChanged: false,
    });
    assert.equal(isDeployed, true);
    assert.deepEqual(events.slice(-2), ["health mlb", "health wnba"]);
    assert.ok(lines.includes("accounts: health check: ok"));
    assert.ok(
      !calls.some(
        ({ url, init }) =>
          url.includes("/scripts/accounts") && ["PUT", "POST"].includes(init.method),
      ),
    );
  }
});

test("an unchanged service that fails its own release check is reported without rolling it back", async () => {
  const { isDeployed, errors, calls } = await deployServiceAndApps({
    isServiceChanged: false,
    reportedRelease: NEW_COMMIT.slice(0, 7),
  });
  assert.equal(isDeployed, false);
  assert.match(errors[0], /The service didn't answer as the live version/);
  assert.match(errors[0], /not 1111111/);
  assert.ok(
    !calls.some(({ init }) => init.method === "POST" && String(init.body).includes("versions")),
  );
});

test("a failed app rolls itself back before the deferred service check still runs", async () => {
  const { isDeployed, events, errors } = await deployServiceAndApps({
    isAppBroken: true,
    healthProblem: "not ready",
  });
  assert.equal(isDeployed, false);
  assert.ok(events.indexOf("rollback wnba-app") < events.indexOf("health mlb"));
  assert.ok(events.includes("rollback accounts"));
  assert.equal(errors.length, 2);
  assert.match(errors[0], /wnba: The page didn't draw/);
  assert.match(errors[1], /accounts: The service didn't answer/);
});

test("a service still unbound after app deploys has only the skipped-check notice", async () => {
  const { isDeployed, events, lines } = await deployServiceAndApps({ areAppsUnbound: true });
  assert.equal(isDeployed, true);
  assert.deepEqual(events.slice(-2), ["health mlb", "health wnba"]);
  assert.ok(
    lines.includes("accounts: ::notice::health check: skipped, no app reaches accounts yet"),
  );
  assert.ok(!events.includes("rollback accounts"));
});

test("a check-only service with no recorded live release fails without uploading or rolling back", async () => {
  const { isDeployed, errors, events } = await deployServiceAndApps({
    isAppOnly: true,
    isLiveCommitMissing: true,
  });
  assert.equal(isDeployed, false);
  assert.match(errors[0], /The service has no recorded live commit to check/);
  assert.ok(!events.includes("upload accounts"));
  assert.ok(!events.includes("rollback accounts"));
});
