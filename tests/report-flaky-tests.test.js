import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ISSUE_TITLE,
  addToTable,
  collectFailedTests,
  findReportWindow,
  listFailedTests,
  listFlakyRuns,
  mergeFailedTests,
  postReport,
  readRunFailures,
  readTable,
  renderTable,
} from "../worker/report-flaky-tests.mjs";

const REPOSITORY = "owner/sports-apps";
const RUN_URL = "https://github.com/owner/sports-apps/actions/runs/1";
const COLOR_RED = `${String.fromCharCode(27)}[31m`;
const COLOR_END = `${String.fromCharCode(27)}[39m`;

/**
 * A test's results in a Playwright JSON report, one for each run.
 * @param {string} projectName
 * @param {{ status: string, message?: string }[]} results
 */
const reportTest = (projectName, results) => ({
  projectName,
  results: results.map(({ status, message }) => ({
    status,
    ...(message ? { error: { message } } : {}),
  })),
});

// Shaped as Playwright's JSON reporter writes a run of a test file three times over: each run is a
// test of its own under the spec.
const nightReport = {
  suites: [
    {
      title: "at-rest.spec.mjs",
      specs: [
        {
          title: "a tab tap leaves the page at rest",
          file: "at-rest.spec.mjs",
          line: 16,
          tests: [
            reportTest("wnba-webkit", [{ status: "passed" }]),
            reportTest("wnba-webkit", [
              {
                status: "failed",
                message: `${COLOR_RED}Error: The page kept animating: opacity on span.stamp${COLOR_END}\nmore`,
              },
            ]),
            reportTest("wnba-webkit", [{ status: "passed" }]),
          ],
        },
      ],
      suites: [
        {
          title: "on a phone",
          specs: [
            {
              title: "a reload shows today after two minutes away",
              file: "last-drawn.spec.mjs",
              line: 58,
              tests: [
                reportTest("wnba", [{ status: "timedOut", message: "Test timeout exceeded." }]),
                reportTest("wnba", [{ status: "failed", message: "toBeInViewport() failed" }]),
                reportTest("wnba", [{ status: "passed" }]),
              ],
            },
            {
              title: "a passing test",
              file: "last-drawn.spec.mjs",
              line: 99,
              tests: [reportTest("wnba", [{ status: "passed" }])],
            },
          ],
        },
      ],
    },
  ],
};

test("each test that failed in any run is named once, by its project, file, and describe blocks, the most failed first", () => {
  assert.deepEqual(listFailedTests([nightReport]), [
    {
      name: "[wnba] last-drawn.spec.mjs:58 > on a phone > a reload shows today after two minutes away",
      runs: 3,
      failures: 2,
      message: "Test timeout exceeded.",
    },
    {
      name: "[wnba-webkit] at-rest.spec.mjs:16 > a tab tap leaves the page at rest",
      runs: 3,
      failures: 1,
      message: "Error: The page kept animating: opacity on span.stamp",
    },
  ]);
});

test("a test's runs add up across the reports of each shard", () => {
  const [failed] = listFailedTests([nightReport, nightReport]);

  assert.equal(failed.runs, 6);
  assert.equal(failed.failures, 4);
});

test("a night where every test passed names none", () => {
  const passed = structuredClone(nightReport);
  passed.suites[0].specs[0].tests.splice(1, 1);
  passed.suites[0].suites[0].specs[0].tests.splice(0, 2);

  assert.deepEqual(listFailedTests([passed]), []);
});

// Shaped as a pull request's run, where a failed test runs once more.
const retryPassedSpec = {
  title: "a test its retry passed",
  file: "resume.spec.mjs",
  line: 160,
  tests: [
    reportTest("wnba", [{ status: "failed", message: "Expected: null" }, { status: "passed" }]),
  ],
};
const failedBothTriesSpec = {
  title: "a test that failed both tries",
  file: "resume.spec.mjs",
  line: 200,
  tests: [
    reportTest("wnba", [
      { status: "failed", message: "Broken" },
      { status: "failed", message: "Broken" },
    ]),
  ],
};
/** @param {any[]} specs */
const retriedReport = (specs) => ({ suites: [{ title: "resume.spec.mjs", specs }] });

test("a retried run names each test its retry passed", () => {
  assert.deepEqual(listFailedTests([retriedReport([retryPassedSpec])], { isRetried: true }), [
    {
      name: "[wnba] resume.spec.mjs:160 > a test its retry passed",
      runs: 2,
      failures: 1,
      message: "Expected: null",
    },
  ]);
});

test("a retried run where a test failed both tries names none, since its change likely broke the tests a retry passed too", () => {
  const sameReport = retriedReport([retryPassedSpec, failedBothTriesSpec]);
  assert.deepEqual(listFailedTests([sameReport], { isRetried: true }), []);
  const otherShards = [retriedReport([retryPassedSpec]), retriedReport([failedBothTriesSpec])];
  assert.deepEqual(listFailedTests(otherShards, { isRetried: true }), []);
});

const AT_REST = "[wnba-webkit] at-rest.spec.mjs:16 > a tab tap leaves the page at rest";
const LAST_DRAWN =
  "[wnba] last-drawn.spec.mjs:58 > on a phone > a reload shows today after two minutes away";

/** @param {Partial<import("../worker/report-flaky-tests.mjs").TableRow> & { name: string }} row */
const tableRow = (row) => ({
  runs: 3,
  failures: 1,
  message: "Error",
  firstSeen: "2026-10-01",
  lastSeen: "2026-10-01",
  lastRun: RUN_URL,
  ...row,
});

test("a test already in the table adds its runs and failures, keeps when it was first seen, and takes the run's day and error", () => {
  const table = [tableRow({ name: AT_REST, message: "Older error" })];

  const [row] = addToTable(table, listFailedTests([nightReport]).slice(1), {
    day: "2026-10-05",
    runUrl: "https://example.com/run/2",
  });

  assert.deepEqual(row, {
    name: AT_REST,
    runs: 6,
    failures: 2,
    message: "Error: The page kept animating: opacity on span.stamp",
    firstSeen: "2026-10-01",
    lastSeen: "2026-10-05",
    lastRun: "https://example.com/run/2",
  });
});

test("a row stays for a week from its test's last failure, then leaves the table", () => {
  const table = [
    tableRow({ name: "kept", lastSeen: "2026-10-04" }),
    tableRow({ name: "gone", lastSeen: "2026-10-03" }),
  ];

  const kept = addToTable(table, [], { day: "2026-10-10", runUrl: RUN_URL });

  assert.deepEqual(
    kept.map((row) => row.name),
    ["kept"],
  );
});

test("the table reads back from the issue's body as it was written, even an error that would close the comment", () => {
  const table = [tableRow({ name: AT_REST, message: "Expected <!-- x --> | `y`" })];

  const body = renderTable(table);

  assert.deepEqual(readTable(body), table);
  assert.match(body, /\| `\[wnba-webkit\] at-rest\.spec\.mjs:16 > a tab tap/);
  assert.match(body, /\| 1 of 3 runs \| 2026-10-01 \| \[2026-10-01\]\(https:/);
  assert.equal(body.match(/-->/g)?.length, 1);
});

test("an issue's body without a table reads as an empty table", () => {
  assert.deepEqual(readTable(null), []);
  assert.deepEqual(readTable("Opened by hand"), []);
});

/**
 * GitHub's API with these open issues, keeping what's written.
 * @param {{ number: number, title: string, body?: string, pull_request?: object }[]} issues
 */
function createFakeGitHub(issues) {
  /** @type {{ method: string, path: string, body: any, headers: any }[]} */
  const written = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(String(url));
    const method = init?.method ?? "GET";
    if (method === "GET") return Response.json(issues);
    written.push({
      method,
      path: pathname,
      body: JSON.parse(String(init?.body)),
      headers: init?.headers,
    });
    return Response.json({ number: 7 });
  };
  return { fetchImpl, written };
}

const ROUTINE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_example/fire";
const WITH_ROUTINE = {
  GH_TOKEN: "token",
  FLAKY_ROUTINE_URL: ROUTINE_URL,
  FLAKY_ROUTINE_TOKEN: "routine-token",
};

/**
 * @param {ReturnType<typeof createFakeGitHub>} github
 * @param {import("../worker/report-flaky-tests.mjs").TestRuns[]} failed
 * @param {NodeJS.ProcessEnv} [env]
 */
const post = (github, failed, env = { GH_TOKEN: "token" }) =>
  postReport({
    repository: REPOSITORY,
    failed,
    runUrl: RUN_URL,
    now: new Date("2026-10-10T07:40:00Z"),
    fetchImpl: github.fetchImpl,
    env,
  });

test("a run with failures opens the issue, with its table, when none is open", async () => {
  const github = createFakeGitHub([{ number: 3, title: "Something else" }]);

  await post(github, listFailedTests([nightReport]));

  assert.equal(github.written.length, 1);
  const [opened] = github.written;
  assert.equal(opened.path, `/repos/${REPOSITORY}/issues`);
  assert.equal(opened.body.title, ISSUE_TITLE);
  assert.deepEqual(
    readTable(opened.body.body).map((row) => [row.name, row.lastSeen]),
    [
      [LAST_DRAWN, "2026-10-10"],
      [AT_REST, "2026-10-10"],
    ],
  );
});

test("a run with no failures writes nothing when no issue is open", async () => {
  const github = createFakeGitHub([]);

  await post(github, []);

  assert.deepEqual(github.written, []);
});

test("a run updates the open issue's table, rather than opening another, and comments only on the tests new to it", async () => {
  const body = renderTable([tableRow({ name: AT_REST, lastSeen: "2026-10-09" })]);
  const github = createFakeGitHub([
    { number: 4, title: ISSUE_TITLE, pull_request: {} },
    { number: 5, title: ISSUE_TITLE, body },
  ]);

  await post(github, listFailedTests([nightReport]));

  const [update, comment] = github.written;
  assert.equal(github.written.length, 2);
  assert.equal(update.method, "PATCH");
  assert.equal(update.path, `/repos/${REPOSITORY}/issues/5`);
  assert.deepEqual(
    readTable(update.body.body).map((row) => [row.name, row.failures]),
    [
      [AT_REST, 2],
      [LAST_DRAWN, 2],
    ],
  );
  assert.equal(comment.path, `/repos/${REPOSITORY}/issues/5/comments`);
  assert.match(comment.body.body, /Found a test new to the table:/);
  assert.match(comment.body.body, /last-drawn\.spec\.mjs:58/);
  assert.doesNotMatch(comment.body.body, /at-rest/);
});

test("a run whose failures are all in the table updates it without a comment", async () => {
  const body = renderTable([tableRow({ name: AT_REST }), tableRow({ name: LAST_DRAWN })]);
  const github = createFakeGitHub([{ number: 5, title: ISSUE_TITLE, body }]);

  await post(github, listFailedTests([nightReport]));

  assert.deepEqual(
    github.written.map(({ method, path }) => [method, path]),
    [["PATCH", `/repos/${REPOSITORY}/issues/5`]],
  );
});

test("a run that leaves the table empty closes the issue as completed", async () => {
  const body = renderTable([tableRow({ name: AT_REST, lastSeen: "2026-10-03" })]);
  const github = createFakeGitHub([{ number: 5, title: ISSUE_TITLE, body }]);

  await post(github, []);

  assert.equal(github.written.length, 1);
  assert.equal(github.written[0].body.state, "closed");
  assert.equal(github.written[0].body.state_reason, "completed");
});

test("a run with no failures keeps the issue open while a row is under a week old", async () => {
  const body = renderTable([tableRow({ name: AT_REST, lastSeen: "2026-10-04" })]);
  const github = createFakeGitHub([{ number: 5, title: ISSUE_TITLE, body }]);

  await post(github, []);

  assert.equal(github.written.length, 1);
  assert.equal(github.written[0].body.state, undefined);
});

test("lists of failed tests add up each test's runs and failures, the most failed first", () => {
  const once = { name: AT_REST, runs: 10, failures: 1, message: "Error: first" };
  const again = { name: AT_REST, runs: 3, failures: 2, message: "Error: second" };
  const other = { name: LAST_DRAWN, runs: 10, failures: 2, message: "" };
  assert.deepEqual(mergeFailedTests([[once, other], [again]]), [
    { name: AT_REST, runs: 13, failures: 3, message: "Error: first" },
    other,
  ]);
});

test("a test new to the table starts the fix routine through its API trigger, naming the test", async () => {
  const body = renderTable([tableRow({ name: AT_REST })]);
  const github = createFakeGitHub([{ number: 5, title: ISSUE_TITLE, body }]);

  await post(github, listFailedTests([nightReport]), WITH_ROUTINE);

  const fired = github.written.filter(({ path }) => path.endsWith("/fire"));
  assert.equal(fired.length, 1);
  assert.equal(fired[0].path, new URL(ROUTINE_URL).pathname);
  assert.equal(fired[0].headers.authorization, "Bearer routine-token");
  assert.equal(fired[0].headers["anthropic-version"], "2023-06-01");
  assert.match(fired[0].body.text, /last-drawn\.spec\.mjs:58/);
  assert.doesNotMatch(fired[0].body.text, /at-rest/);
});

test("the first flaky test, which opens the issue, starts the fix routine too", async () => {
  const github = createFakeGitHub([]);

  await post(github, listFailedTests([nightReport]), WITH_ROUTINE);

  assert.equal(github.written.filter(({ path }) => path.endsWith("/fire")).length, 1);
});

test("a run with no test new to the table starts no routine", async () => {
  const body = renderTable([tableRow({ name: AT_REST }), tableRow({ name: LAST_DRAWN })]);
  const github = createFakeGitHub([{ number: 5, title: ISSUE_TITLE, body }]);

  await post(github, listFailedTests([nightReport]), WITH_ROUTINE);

  assert.equal(github.written.filter(({ path }) => path.endsWith("/fire")).length, 0);
});

test("a fix routine that doesn't answer leaves the report done, and says so", async () => {
  const body = renderTable([tableRow({ name: AT_REST })]);
  const github = createFakeGitHub([{ number: 5, title: ISSUE_TITLE, body }]);
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    if (String(url) === ROUTINE_URL) throw new Error("The operation was aborted due to timeout");
    return github.fetchImpl(url, init);
  };

  const logged = await postReport({
    repository: REPOSITORY,
    failed: listFailedTests([nightReport]),
    runUrl: RUN_URL,
    now: new Date("2026-10-10T07:40:00Z"),
    fetchImpl,
    env: WITH_ROUTINE,
  });

  assert.match(logged, /Updated #5: .*The fix routine didn't answer: The operation was aborted/);
  assert.deepEqual(
    github.written.map(({ method, path }) => [method, path]),
    [
      ["PATCH", `/repos/${REPOSITORY}/issues/5`],
      ["POST", `/repos/${REPOSITORY}/issues/5/comments`],
    ],
  );
});

test("without the routine's trigger set, a new test starts no routine", async () => {
  const github = createFakeGitHub([]);

  assert.match(await post(github, listFailedTests([nightReport])), /No fix routine is set up/);
  assert.equal(github.written.filter(({ path }) => path.endsWith("/fire")).length, 0);
});

const NIGHT_RUN = "900";
const REPOSITORY_ID = 41;

/** @typedef {string | { name: string, created_at: string }} FakeArtifact */

/**
 * @typedef {object} FakeCiRun
 * @property {number} id
 * @property {string} updated_at when it ended
 * @property {string} [run_started_at] when its latest try began, an hour before it ended unless named
 * @property {string} [status]
 * @property {number} [head_repository_id]
 * @property {FakeArtifact[]} [artifacts] each made as the run ended unless named
 */

/** A CI run's address, apart from the nightly run's. @param {number} id */
const nameRunUrl = (id) => `https://github.com/${REPOSITORY}/actions/runs/${1000 + id}`;

/**
 * GitHub's API as the nightly report reads it: the nightly runs, newest first, each with its
 * report job, and CI's runs, each with its artifacts.
 * @param {object} state
 * @param {{ id: number | string, report?: { started_at: string, conclusion: string | null } }[]} state.nights
 * @param {FakeCiRun[]} [state.ciRuns]
 */
function createFakeRunsApi({ nights, ciRuns = [] }) {
  /** @type {string[]} */
  const asked = [];
  /** @param {string} path */
  const github = async (path) => {
    asked.push(path);
    const jobs = path.match(/^\/actions\/runs\/(\d+)\/jobs/);
    if (jobs) {
      const night = nights.find(({ id }) => String(id) === jobs[1]);
      return { jobs: night?.report ? [{ name: "report", ...night.report }] : [] };
    }
    if (path.startsWith("/actions/workflows/flaky.yml/runs"))
      return { workflow_runs: nights.map(({ id }) => ({ id })) };
    if (path.startsWith("/actions/workflows/ci.yml/runs"))
      return {
        workflow_runs: ciRuns.map((run) => ({
          id: run.id,
          html_url: nameRunUrl(run.id),
          status: run.status ?? "completed",
          updated_at: run.updated_at,
          run_started_at:
            run.run_started_at ?? new Date(Date.parse(run.updated_at) - 3600000).toISOString(),
          repository: { id: REPOSITORY_ID },
          head_repository: { id: run.head_repository_id ?? REPOSITORY_ID },
        })),
      };
    const artifacts = path.match(/^\/actions\/runs\/(\d+)\/artifacts/);
    if (artifacts) {
      const run = ciRuns.find(({ id }) => String(id) === artifacts[1]);
      return {
        artifacts: (run?.artifacts ?? []).map((artifact) =>
          typeof artifact === "string"
            ? { name: artifact, created_at: run?.updated_at, expired: false }
            : { ...artifact, expired: false },
        ),
      };
    }
    throw new Error(`unexpected ${path}`);
  };
  return { github: /** @type {any} */ (github), asked };
}

const THIS_NIGHT = {
  id: NIGHT_RUN,
  report: { started_at: "2026-10-10T07:40:00Z", conclusion: null },
};

test("a night takes the CI runs that ended since the last night whose report went through", async () => {
  const { github } = createFakeRunsApi({
    nights: [
      THIS_NIGHT,
      { id: 899, report: { started_at: "2026-10-09T07:40:00Z", conclusion: "failure" } },
      { id: 898, report: { started_at: "2026-10-08T07:40:00Z", conclusion: "success" } },
    ],
  });
  assert.deepEqual(
    await findReportWindow(github, { runId: NIGHT_RUN, now: new Date("2026-10-10T08:00:00Z") }),
    { since: new Date("2026-10-08T07:40:00Z"), until: new Date("2026-10-10T07:40:00Z") },
  );
});

test("a first night looks back over the week the table keeps", async () => {
  const { github } = createFakeRunsApi({ nights: [THIS_NIGHT, { id: 899 }] });
  assert.deepEqual(
    await findReportWindow(github, { runId: NIGHT_RUN, now: new Date("2026-10-10T08:00:00Z") }),
    { since: new Date("2026-10-03T07:40:00Z"), until: new Date("2026-10-10T07:40:00Z") },
  );
});

const WINDOW = { since: new Date("2026-10-09T07:40:00Z"), until: new Date("2026-10-10T07:40:00Z") };

test("each of this repository's CI runs that ended in the window and kept a report is taken, with its address", async () => {
  const { github, asked } = createFakeRunsApi({
    nights: [],
    ciRuns: [
      {
        id: 1,
        updated_at: "2026-10-09T12:00:00Z",
        artifacts: ["browser-report-3", "burn-in-flaky-2"],
      },
      { id: 2, updated_at: "2026-10-09T13:00:00Z", artifacts: ["ci-passed-abc", "review-share-1"] },
      {
        id: 3,
        updated_at: "2026-10-09T14:00:00Z",
        head_repository_id: 99,
        artifacts: ["browser-report-1"],
      },
      { id: 4, updated_at: "2026-10-09T07:39:59Z", artifacts: ["browser-report-1"] },
      { id: 5, updated_at: "2026-10-10T07:40:00Z", artifacts: ["browser-report-1"] },
    ],
  });

  assert.deepEqual(await listFlakyRuns(github, WINDOW), [
    {
      id: 1,
      names: ["browser-report-3", "burn-in-flaky-2"],
      foundIn: { url: nameRunUrl(1), at: "2026-10-09T12:00:00Z" },
    },
  ]);
  assert.ok(
    asked[0].startsWith(
      "/actions/workflows/ci.yml/runs?status=completed&created=>=2026-10-08T07:40:00Z&",
    ),
    asked[0],
  );
  assert.deepEqual(
    asked.filter((path) => path.includes("/artifacts")),
    ["/actions/runs/1/artifacts?per_page=100", "/actions/runs/2/artifacts?per_page=100"],
  );
});

test("a run whose job ran again gives only what its latest try made, since a night before took the try before", async () => {
  const { github } = createFakeRunsApi({
    nights: [],
    ciRuns: [
      {
        id: 8,
        updated_at: "2026-10-09T09:00:00Z",
        run_started_at: "2026-10-09T08:55:00Z",
        artifacts: [
          { name: "browser-report-2", created_at: "2026-10-09T06:00:00Z" },
          { name: "burn-in-flaky-1", created_at: "2026-10-09T06:05:00Z" },
        ],
      },
      {
        id: 9,
        updated_at: "2026-10-09T10:00:00Z",
        run_started_at: "2026-10-09T09:30:00Z",
        artifacts: [
          { name: "browser-report-1", created_at: "2026-10-09T05:00:00Z" },
          { name: "browser-report-4", created_at: "2026-10-09T09:55:00Z" },
        ],
      },
    ],
  });

  assert.deepEqual(
    (await listFlakyRuns(github, WINDOW)).map(({ id, names }) => ({ id, names })),
    [{ id: 9, names: ["browser-report-4"] }],
  );
});

test("a run still going as a night's window closes goes whole to the next night, both its reports together", async () => {
  const shard1 = { name: "browser-report-1", created_at: "2026-10-10T07:39:00Z" };
  const shard2 = { name: "browser-report-2", created_at: "2026-10-10T07:41:00Z" };
  const going = createFakeRunsApi({
    nights: [],
    ciRuns: [
      {
        id: 10,
        status: "in_progress",
        updated_at: "2026-10-10T07:39:00Z",
        run_started_at: "2026-10-10T07:20:00Z",
        artifacts: [shard1],
      },
    ],
  });
  assert.deepEqual(await listFlakyRuns(going.github, WINDOW), []);

  const ended = createFakeRunsApi({
    nights: [],
    ciRuns: [
      {
        id: 10,
        updated_at: "2026-10-10T07:42:00Z",
        run_started_at: "2026-10-10T07:20:00Z",
        artifacts: [shard1, shard2],
      },
    ],
  });
  const nextWindow = {
    since: WINDOW.until,
    until: new Date("2026-10-11T07:40:00Z"),
  };
  assert.deepEqual(
    (await listFlakyRuns(ended.github, nextWindow)).map(({ id, names }) => ({ id, names })),
    [{ id: 10, names: ["browser-report-1", "browser-report-2"] }],
  );
});

/**
 * A folder of a CI run's artifacts, each in a folder of its own, as GitHub's CLI downloads them.
 * @param {Record<string, unknown>} files by path inside the folder
 */
function writeRunFolder(files) {
  const directory = mkdtempSync(join(tmpdir(), "flaky-run-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), JSON.stringify(content));
  }
  return directory;
}

const BURN_IN_FLAKY = {
  name: "[wnba] page.spec.mjs:40 > a test the pull request didn't write",
  runs: 10,
  failures: 2,
  message: "Timed out",
};
const RETRY_PASSED = "[wnba] resume.spec.mjs:160 > a test its retry passed";
const CI_RUN = { url: nameRunUrl(1), at: "2026-10-09T12:00:00Z" };

test("a run's tests are those its retry passed and those burn-in named, each found in that run, unless a test failed every try", () => {
  const directory = writeRunFolder({
    "browser-report-3/test-results/report.json": retriedReport([retryPassedSpec]),
    "burn-in-flaky-2/burn-in-flaky.json": [BURN_IN_FLAKY],
  });
  const failed = readRunFailures(directory, CI_RUN);
  assert.deepEqual(
    failed.map(({ name }) => name).toSorted(),
    [BURN_IN_FLAKY.name, RETRY_PASSED].toSorted(),
  );
  assert.ok(failed.every(({ foundIn }) => foundIn === CI_RUN));
  const broken = writeRunFolder({
    "browser-report-1/test-results/report.json": retriedReport([retryPassedSpec]),
    "browser-report-2/test-results/report.json": retriedReport([failedBothTriesSpec]),
  });
  assert.deepEqual(readRunFailures(broken, CI_RUN), []);
});

test("a test only a CI run found names that run as its last, and one found in two runs names the newer", async () => {
  const earlier = { url: nameRunUrl(1), at: "2026-10-09T12:00:00Z" };
  const later = { url: nameRunUrl(7), at: "2026-10-09T18:00:00Z" };
  const test1 = { name: RETRY_PASSED, runs: 2, failures: 1, message: "Expected: null" };
  const merged = mergeFailedTests([
    [{ ...test1, foundIn: later }],
    [{ ...test1, foundIn: earlier }],
  ]);
  assert.deepEqual(merged[0].foundIn, later);
  assert.deepEqual(
    mergeFailedTests([[{ ...test1, foundIn: earlier }], [test1]])[0].foundIn,
    earlier,
  );

  const github = createFakeGitHub([]);
  await post(github, [{ ...test1, foundIn: earlier }], WITH_ROUTINE);
  const [opened, fired] = github.written;
  assert.equal(readTable(opened.body.body)[0].lastRun, nameRunUrl(1));
  assert.match(
    fired.body.text,
    new RegExp(`a test its retry passed\`, in \\[its run\\]\\(${nameRunUrl(1)}\\)`),
  );
  assert.doesNotMatch(fired.body.text, new RegExp(RUN_URL.replaceAll("/", "\\/") + "\\)"));
});

test("a night's report holds its own tests, found in it, and every CI run's its window takes, each downloaded once", async () => {
  const { github } = createFakeRunsApi({
    nights: [
      THIS_NIGHT,
      { id: 898, report: { started_at: "2026-10-09T07:40:00Z", conclusion: "success" } },
    ],
    ciRuns: [
      { id: 1, updated_at: "2026-10-09T12:00:00Z", artifacts: ["browser-report-3"] },
      { id: 7, updated_at: "2026-10-09T18:00:00Z", artifacts: ["burn-in-flaky-1"] },
    ],
  });
  const folders = {
    1: writeRunFolder({
      "browser-report-3/test-results/report.json": retriedReport([retryPassedSpec]),
    }),
    7: writeRunFolder({ "burn-in-flaky-1/burn-in-flaky.json": [BURN_IN_FLAKY] }),
  };
  /** @type {import("../worker/report-flaky-tests.mjs").FlakyRun[]} */
  const downloaded = [];

  const failed = await collectFailedTests({
    nightReports: [nightReport],
    github,
    night: { runId: NIGHT_RUN, url: RUN_URL, now: new Date("2026-10-10T08:00:00Z") },
    download: (run) => {
      downloaded.push(run);
      return folders[run.id];
    },
  });

  assert.deepEqual(
    downloaded.map(({ id, names }) => ({ id, names })),
    [
      { id: 1, names: ["browser-report-3"] },
      { id: 7, names: ["burn-in-flaky-1"] },
    ],
  );
  assert.deepEqual(Object.fromEntries(failed.map(({ name, foundIn }) => [name, foundIn?.url])), {
    [LAST_DRAWN]: RUN_URL,
    [AT_REST]: RUN_URL,
    [RETRY_PASSED]: nameRunUrl(1),
    [BURN_IN_FLAKY.name]: nameRunUrl(7),
  });
});
