import test from "node:test";
import assert from "node:assert/strict";
import {
  ISSUE_TITLE,
  addToTable,
  listFailedTests,
  mergeFailedTests,
  postReport,
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
const retriedReport = {
  suites: [
    {
      title: "resume.spec.mjs",
      specs: [
        {
          title: "a test its retry passed",
          file: "resume.spec.mjs",
          line: 160,
          tests: [
            reportTest("wnba", [
              { status: "failed", message: "Expected: null" },
              { status: "passed" },
            ]),
          ],
        },
        {
          title: "a test that failed both tries",
          file: "resume.spec.mjs",
          line: 200,
          tests: [
            reportTest("wnba", [
              { status: "failed", message: "Broken" },
              { status: "failed", message: "Broken" },
            ]),
          ],
        },
      ],
    },
  ],
};

test("where a failed test is retried, only one its retry passed is named, since one that failed both tries fails its pull request", () => {
  assert.deepEqual(listFailedTests([retriedReport], { isRetried: true }), [
    {
      name: "[wnba] resume.spec.mjs:160 > a test its retry passed",
      runs: 2,
      failures: 1,
      message: "Expected: null",
    },
  ]);
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
  assert.match(comment.body.body, /found a test new to the table:/);
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

test("without the routine's trigger set, a new test starts no routine", async () => {
  const github = createFakeGitHub([]);

  assert.match(await post(github, listFailedTests([nightReport])), /No fix routine is set up/);
  assert.equal(github.written.filter(({ path }) => path.endsWith("/fire")).length, 0);
});
