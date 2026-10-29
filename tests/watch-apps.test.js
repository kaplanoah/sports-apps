import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "./repo-files.js";
import { checkAppPage } from "../worker/check-page.mjs";
import {
  nameFeedIssue,
  nameNoCodeIssue,
  nameOutageIssue,
  nameServiceAttentionIssue,
  nameServiceIssue,
  watchApps,
} from "../worker/watch-apps.mjs";

const REPOSITORY = "owner/sports-apps";
const RUN_URL = "https://github.com/owner/sports-apps/actions/runs/1";
const API = `https://api.github.com/repos/${REPOSITORY}`;

/**
 * GitHub with `openIssues` open, recording each call that writes.
 * @param {any[]} openIssues
 */
function createFakeGitHub(openIssues) {
  const writes = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init = {}) => {
    const path = String(url).replace(API, "");
    const method = init.method ?? "GET";
    if (method === "GET") return Response.json(path.startsWith("/issues?") ? openIssues : []);
    writes.push({ method, path, body: JSON.parse(String(init.body)) });
    return Response.json({ number: 7 });
  };
  return { fetchImpl, writes };
}

/**
 * @param {Record<string, import("../worker/check-page.mjs").PageCheck>} checks by app
 * @param {any[]} [openIssues]
 * @param {Record<string, import("../worker/check-service.mjs").ServiceCheck>} [serviceChecks] by service
 * @param {Record<string, import("../worker/check-feeds.mjs").FeedCheck>} [feedChecks] by app, each
 *   answering unless named
 */
async function watch(checks, openIssues = [], serviceChecks = {}, feedChecks = {}) {
  const github = createFakeGitHub(openIssues);
  const lines = await watchApps({
    repository: REPOSITORY,
    runUrl: RUN_URL,
    apps: Object.keys(checks),
    checkApp: async (app) => checks[app],
    services: Object.keys(serviceChecks),
    checkServiceOf: async (service) => serviceChecks[service],
    checkFeedsOf: async (app) => feedChecks[app] ?? { status: "answering" },
    fetchImpl: github.fetchImpl,
    env: { GH_TOKEN: "token" },
  });
  return { lines, writes: github.writes };
}

/** @type {import("../worker/check-page.mjs").PageCheck} */
const BROKEN = { status: "broken", reason: "the page drew nothing within 30 seconds" };

test("an app that isn't opening gets one issue, saying why and linking the run", async () => {
  const { lines, writes } = await watch({ wnba: BROKEN, mlb: { status: "drawn" } });

  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues",
      body: {
        title: "The WNBA app isn't opening",
        body: `Opened twice a minute apart, the page drew nothing within 30 seconds.\n\nSee [the check's run](${RUN_URL}). This issue closes itself once the app opens again.`,
      },
    },
  ]);
  assert.deepEqual(lines, [
    "wnba: not opening, the page drew nothing within 30 seconds; opened #7",
    "mlb: opens",
  ]);
});

test("an app still not opening leaves its open issue as it is", async () => {
  const open = { number: 3, title: nameOutageIssue("wnba") };

  const { lines, writes } = await watch({ wnba: BROKEN }, [open]);

  assert.deepEqual(writes, []);
  assert.deepEqual(lines, [
    "wnba: still not opening, the page drew nothing within 30 seconds; #3 is open",
  ]);
});

test("an app that opens again says so on its issue and closes it", async () => {
  const pullRequest = { number: 2, title: nameOutageIssue("wnba"), pull_request: {} };
  const open = { number: 3, title: nameOutageIssue("wnba") };

  const { lines, writes } = await watch({ wnba: { status: "drawn" } }, [pullRequest, open]);

  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues/3/comments",
      body: { body: `The app opens again, as of [this run](${RUN_URL}).` },
    },
    { method: "PATCH", path: "/issues/3", body: { state: "closed", state_reason: "completed" } },
  ]);
  assert.deepEqual(lines, ["wnba: opens again, so #3 is closed"]);
});

test("an app that can't be checked warns in the run and touches no issue", async () => {
  const open = { number: 3, title: nameOutageIssue("mlb") };

  const { lines, writes } = await watch(
    { mlb: { status: "unchecked", reason: "the Worker refused the access code" } },
    [open],
  );

  assert.deepEqual(writes, []);
  assert.deepEqual(lines, ["::warning::mlb: not checked, the Worker refused the access code"]);
});

/** @type {import("../worker/check-page.mjs").PageCheck} */
const OPEN_WITHOUT_CODE = {
  status: "drawn",
  isOpenWithoutCode: true,
};

test("an app that opens without asking for its code gets an issue of its own, and warns in the run", async () => {
  const { lines, writes } = await watch({ mlb: OPEN_WITHOUT_CODE });

  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues",
      body: {
        title: "The MLB app asks for no code",
        body: `The page opened without asking for its access code, so anyone with its address can open it. Give it the code every app asks for again with \`npm run set-access-code -- mlb <code>\`.\n\nSee [the check's run](${RUN_URL}). This issue closes itself once the app asks for its code again, or the \`production\` environment holds no \`ACCESS_CODE\`, which stops this check for every app.`,
      },
    },
  ]);
  assert.deepEqual(lines, ["mlb: opens", "::warning::mlb: opens without its code; opened #7"]);
});

test("an app that opens again without asking for its code closes its outage and keeps warning", async () => {
  const outage = { number: 3, title: nameOutageIssue("mlb") };
  const noCode = { number: 4, title: nameNoCodeIssue("mlb") };

  const { lines, writes } = await watch({ mlb: OPEN_WITHOUT_CODE }, [outage, noCode]);

  assert.deepEqual(
    writes.map(({ method, path }) => `${method} ${path}`),
    ["POST /issues/3/comments", "PATCH /issues/3"],
  );
  assert.deepEqual(lines, [
    "mlb: opens again, so #3 is closed",
    "::warning::mlb: opens without its code; #4 is open",
  ]);
});

test("an app that asks for its code again closes its no-code issue", async () => {
  const noCode = { number: 4, title: nameNoCodeIssue("mlb") };

  const { lines, writes } = await watch({ mlb: { status: "drawn" } }, [noCode]);

  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues/4/comments",
      body: { body: `The app asks for its code again, as of [this run](${RUN_URL}).` },
    },
    { method: "PATCH", path: "/issues/4", body: { state: "closed", state_reason: "completed" } },
  ]);
  assert.deepEqual(lines, ["mlb: opens", "mlb: asks for its code again, so #4 is closed"]);
});

test("a check that can't open a browser fails the watch's run, rather than passing it unchecked", async () => {
  const github = createFakeGitHub([]);
  await assert.rejects(
    watchApps({
      repository: REPOSITORY,
      runUrl: RUN_URL,
      apps: ["mlb"],
      checkApp: async () => {
        throw new Error("browserType.launch: Executable doesn't exist");
      },
      services: [],
      checkFeedsOf: async () => ({ status: "answering" }),
      fetchImpl: github.fetchImpl,
      env: { GH_TOKEN: "token" },
    }),
    /Executable doesn't exist/,
  );
});

const SERVICE_ISSUE = { number: 9, title: nameServiceIssue("accounts") };
/** @type {import("../worker/check-service.mjs").ServiceCheck} */
const UNANSWERED = { status: "unanswered", reason: "mlb finds accounts not ok: no RP_ID secret" };

test("a service that isn't answering the apps gets one issue, saying why and linking the run", async () => {
  const { lines, writes } = await watch({}, [], { accounts: UNANSWERED });
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues",
      body: {
        title: "The accounts service isn't answering",
        body: `Asked through each app's health twice a minute apart, mlb finds accounts not ok: no RP_ID secret.\n\nSee [the check's run](${RUN_URL}). This issue closes itself once the service answers again.`,
      },
    },
  ]);
  assert.deepEqual(lines, [
    "accounts: not answering, mlb finds accounts not ok: no RP_ID secret; opened #7",
  ]);

  const still = await watch({}, [SERVICE_ISSUE], { accounts: UNANSWERED });
  assert.deepEqual(still.writes, []);
  assert.deepEqual(still.lines, [
    "accounts: still not answering, mlb finds accounts not ok: no RP_ID secret; #9 is open",
  ]);
});

test("a service that answers again says so on its issue and closes it, and one no app reaches warns", async () => {
  const { lines, writes } = await watch({}, [SERVICE_ISSUE], {
    accounts: { status: "answering" },
  });
  assert.deepEqual(
    writes.map(({ method, path }) => `${method} ${path}`),
    ["POST /issues/9/comments", "PATCH /issues/9"],
  );
  assert.deepEqual(writes[1].body, { state: "closed", state_reason: "completed" });
  assert.deepEqual(lines, ["accounts: answers again, so #9 is closed"]);

  const unchecked = await watch({}, [SERVICE_ISSUE], {
    accounts: { status: "unchecked", reason: "no app reaches accounts yet" },
  });
  assert.deepEqual(unchecked.writes, []);
  assert.deepEqual(unchecked.lines, [
    "::warning::accounts: not checked, no app reaches accounts yet",
  ]);
});

const ATTENTION_ISSUE = { number: 11, title: nameServiceAttentionIssue("email") };
/** @type {import("../worker/check-service.mjs").ServiceCheck} */
const NEEDING = { status: "answering", attention: "Contact delivery needs attention" };

test("a service that answers but needs attention gets an issue of its own, and warns in the run", async () => {
  const { lines, writes } = await watch({}, [], { email: NEEDING });
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues",
      body: {
        title: "The email service needs attention",
        body: `The service answers the apps, but says: Contact delivery needs attention.\n\nSee [the check's run](${RUN_URL}). This issue closes itself once the service no longer asks for attention.`,
      },
    },
  ]);
  assert.deepEqual(lines, [
    "email: answers",
    "::warning::email: Contact delivery needs attention; opened #7",
  ]);

  const still = await watch({}, [ATTENTION_ISSUE], { email: NEEDING });
  assert.deepEqual(still.writes, []);
  assert.deepEqual(still.lines, [
    "email: answers",
    "::warning::email: Contact delivery needs attention; #11 is open",
  ]);
});

test("a service that no longer needs attention closes its issue, which an outage leaves as it is", async () => {
  const { lines, writes } = await watch({}, [ATTENTION_ISSUE], {
    email: { status: "answering" },
  });
  assert.deepEqual(
    writes.map(({ method, path }) => `${method} ${path}`),
    ["POST /issues/11/comments", "PATCH /issues/11"],
  );
  assert.deepEqual(lines, ["email: answers", "email: no longer needs attention, so #11 is closed"]);

  const down = await watch({}, [ATTENTION_ISSUE], {
    email: { status: "unanswered", reason: "mlb finds email not ok: its outbox doesn't answer" },
  });
  assert.deepEqual(
    down.writes.map(({ method, path }) => `${method} ${path}`),
    ["POST /issues"],
  );
  assert.equal(down.writes[0].body.title, "The email service isn't answering");
});

test("the watch asks each production app's health of each service", async () => {
  const github = createFakeGitHub([]);
  const asked = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith(API)) return github.fetchImpl(url, init);
    asked.push(String(url));
    return Response.json({ ok: true, services: { accounts: { ok: true, release: "abc1234" } } });
  };
  const lines = await watchApps({
    repository: REPOSITORY,
    runUrl: RUN_URL,
    apps: [],
    services: ["accounts"],
    fetchImpl,
    env: { GH_TOKEN: "token", CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain" },
  });
  assert.deepEqual(lines, ["accounts: answers"]);
  assert.deepEqual(asked, [
    "https://mlb-app.example-subdomain.workers.dev/health",
    "https://wnba-app.example-subdomain.workers.dev/health",
  ]);
});

test("the watch reads each app's address from the workers.dev subdomain the production environment holds", () => {
  const workflow = readRepoFile(".github/workflows/watch.yml");
  assert.match(
    workflow,
    /CLOUDFLARE_WORKERS_SUBDOMAIN: \$\{\{ secrets\.CLOUDFLARE_WORKERS_SUBDOMAIN \}\}/,
  );
});

test("page navigation and direct certificate failures retry and open the watch's outage issue", async () => {
  for (const [name, message] of [
    ["TimeoutError", "page.goto: Timeout exceeded"],
    ["Error", "page.goto: net::ERR_TOO_MANY_REDIRECTS"],
    ["Error", "page.goto: net::ERR_CERT_AUTHORITY_INVALID"],
  ]) {
    let opened = 0;
    const pageUrl = "https://mlb-app.example-subdomain.workers.dev/k3y/";
    const page = {
      on: () => {},
      url: () => pageUrl,
      goto: async () => {
        opened += 1;
        throw Object.assign(new Error(message), { name });
      },
    };
    const context = { on: () => {}, newPage: async () => page, close: async () => {} };
    const browser = {
      isConnected: () => true,
      newContext: async () => context,
      close: async () => {},
    };
    const github = createFakeGitHub([]);
    const lines = await watchApps({
      repository: REPOSITORY,
      runUrl: RUN_URL,
      apps: ["mlb"],
      services: [],
      fetchImpl: github.fetchImpl,
      env: { GH_TOKEN: "token" },
      checkFeedsOf: async () => ({ status: "answering" }),
      checkApp: (app) =>
        checkAppPage({
          app,
          channel: "production",
          env: { MLB_PAGE_URL: pageUrl },
          attempts: 2,
          pauseMs: 0,
          launchBrowser: async () =>
            /** @type {import("@playwright/test").Browser} */ (/** @type {unknown} */ (browser)),
        }),
    });
    assert.equal(opened, 2);
    assert.match(lines[0], /not opening/);
    assert.equal(github.writes[0].body.title, "The MLB app isn't opening");
  }
});

const FEED_ISSUE = { number: 12, title: nameFeedIssue("wnba") };
const SCOREBOARD_FAILING = {
  scoreboard: {
    since: "2026-07-01T18:00:00.000Z",
    reason: "WNBA answered 503 for /scoreboard",
  },
};
/** @type {import("../worker/check-feeds.mjs").FeedCheck} */
const FEEDS_FAILING = { status: "failing", feeds: SCOREBOARD_FAILING };

test("an app whose feeds are failing gets one issue, naming each feed and why, and warns in the run", async () => {
  const { lines, writes } = await watch(
    { wnba: { status: "drawn" } },
    [],
    {},
    {
      wnba: FEEDS_FAILING,
    },
  );

  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues",
      body: {
        title: "The WNBA app's league feeds are failing",
        body: `The app's health says these feeds have been failing for 15 minutes or more:\n\n- \`scoreboard\`: WNBA answered 503 for /scoreboard (failing since 2026-07-01T18:00:00.000Z)\n\nSee [the check's run](${RUN_URL}). This issue closes itself once every feed answers again.`,
      },
    },
  ]);
  assert.deepEqual(lines, ["wnba: opens", "::warning::wnba: feeds failing: scoreboard; opened #7"]);
});

test("an app whose feeds still fail leaves its open issue as it is", async () => {
  const { lines, writes } = await watch(
    { wnba: { status: "drawn" } },
    [FEED_ISSUE],
    {},
    {
      wnba: FEEDS_FAILING,
    },
  );

  assert.deepEqual(writes, []);
  assert.deepEqual(lines, [
    "wnba: opens",
    "::warning::wnba: feeds failing: scoreboard; #12 is open",
  ]);
});

test("an app whose feeds answer again says so on its issue and closes it, and one whose health doesn't say leaves it", async () => {
  const { lines, writes } = await watch({ wnba: { status: "drawn" } }, [FEED_ISSUE]);

  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues/12/comments",
      body: { body: `Every feed answers again, as of [this run](${RUN_URL}).` },
    },
    { method: "PATCH", path: "/issues/12", body: { state: "closed", state_reason: "completed" } },
  ]);
  assert.deepEqual(lines, ["wnba: opens", "wnba: feeds answer again, so #12 is closed"]);

  const unchecked = await watch(
    { wnba: BROKEN },
    [FEED_ISSUE],
    {},
    {
      wnba: { status: "unchecked", reason: "its health doesn't answer" },
    },
  );
  assert.deepEqual(
    unchecked.writes.map((write) => write.path),
    ["/issues"],
  );
  assert.equal(unchecked.lines[1], "::warning::wnba: feeds not checked, its health doesn't answer");
});

test("the watch reads each production app's feeds from its health, masking its address", async () => {
  const github = createFakeGitHub([]);
  const workerUrl = "https://wnba-app.example-subdomain.workers.dev";
  const asked = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith(API)) return github.fetchImpl(url, init);
    asked.push(String(url));
    return Response.json({
      ok: true,
      feeds: {
        scoreboard: {
          since: "2026-07-01T18:00:00.000Z",
          reason: `fetch to ${workerUrl}/scoreboard with c0de failed`,
        },
      },
    });
  };
  const lines = await watchApps({
    repository: REPOSITORY,
    runUrl: RUN_URL,
    apps: ["wnba"],
    checkApp: async () => ({ status: "drawn" }),
    services: [],
    fetchImpl,
    env: {
      GH_TOKEN: "token",
      CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain",
      ACCESS_CODE: "c0de",
    },
  });

  assert.deepEqual(asked, [`${workerUrl}/health`]);
  assert.deepEqual(lines, ["wnba: opens", "::warning::wnba: feeds failing: scoreboard; opened #7"]);
  const { body } = github.writes[0].body;
  assert.match(body, /fetch to <worker>\/scoreboard with <access code> failed/);
  assert.doesNotMatch(body, /example-subdomain|c0de/);
});

test("the watch finds nothing to check in an app's health that says nothing of its feeds", async () => {
  const github = createFakeGitHub([FEED_ISSUE]);
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) =>
    String(url).startsWith(API) ? github.fetchImpl(url, init) : Response.json({ ok: true });
  const lines = await watchApps({
    repository: REPOSITORY,
    runUrl: RUN_URL,
    apps: ["wnba"],
    checkApp: async () => ({ status: "drawn" }),
    services: [],
    fetchImpl,
    env: { GH_TOKEN: "token", CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain" },
  });

  assert.deepEqual(github.writes, []);
  assert.deepEqual(lines, [
    "wnba: opens",
    "::warning::wnba: feeds not checked, its health says nothing of its feeds",
  ]);
});
