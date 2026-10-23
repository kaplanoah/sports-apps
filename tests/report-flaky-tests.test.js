import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ISSUE_TITLE,
  addToTable,
  collectFailedTests,
  listFailedTests,
  listUncountedArtifacts,
  mergeFailedTests,
  postReport,
  readCounted,
  readLedger,
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

test("the table and the artifacts it counted read back from the issue's body as written, even an error that would close the comment", () => {
  const table = [tableRow({ name: AT_REST, message: "Expected <!-- x --> | `y`" })];

  const counted = [{ id: 11, at: "2026-10-01T12:00:00Z" }];

  const body = renderTable(table, counted);

  assert.deepEqual(readTable(body), table);
  assert.deepEqual(readCounted(body), counted);
  assert.match(body, /\| `\[wnba-webkit\] at-rest\.spec\.mjs:16 > a tab tap/);
  assert.match(body, /\| 1 of 3 runs \| 2026-10-01 \| \[2026-10-01\]\(https:/);
  assert.equal(body.match(/-->/g)?.length, 2);
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

const REPOSITORY_ID = 41;

/** A CI run's address, apart from the nightly run's. @param {number} id */
const nameRunUrl = (id) => `https://github.com/${REPOSITORY}/actions/runs/${1000 + id}`;

/**
 * @typedef {object} FakeCiRun
 * @property {number} id
 * @property {string} updated_at when it ended, or last changed while it's going
 * @property {string[]} tries when each of its tries began, its first first
 * @property {string} [status]
 * @property {number} [head_repository_id]
 */

/** @typedef {{ id: number, name: string, created_at: string, run: number }} FakeArtifact */

/**
 * GitHub's API as the nightly report reads it: the repository's artifacts, in the order given, a
 * page at a time, and the CI runs that made them, with each of their tries.
 * @param {{ ciRuns: FakeCiRun[], artifacts: FakeArtifact[] }} state
 */
function createFakeRunsApi(state) {
  /** @type {string[]} */
  const asked = [];
  /** @param {string} id */
  const findRun = (id) => {
    const run = state.ciRuns.find((ciRun) => String(ciRun.id) === id);
    if (!run) throw new Error(`no run ${id}`);
    return run;
  };
  /** @param {FakeArtifact} artifact */
  const showArtifact = ({ run, ...artifact }) => ({
    ...artifact,
    expired: false,
    workflow_run: {
      id: run,
      repository_id: REPOSITORY_ID,
      head_repository_id: findRun(String(run)).head_repository_id ?? REPOSITORY_ID,
    },
  });
  /** @param {string} path */
  const github = async (path) => {
    asked.push(path);
    const page = path.match(/^\/actions\/artifacts\?per_page=(\d+)&page=(\d+)$/);
    if (page) {
      const [size, number] = [Number(page[1]), Number(page[2])];
      const shown = state.artifacts.slice((number - 1) * size, number * size);
      return { artifacts: shown.map(showArtifact) };
    }
    const attempt = path.match(/^\/actions\/runs\/(\d+)\/attempts\/(\d+)$/);
    if (attempt) return { run_started_at: findRun(attempt[1]).tries[Number(attempt[2]) - 1] };
    const run = path.match(/^\/actions\/runs\/(\d+)$/);
    if (run) {
      const { id, status = "completed", updated_at: updatedAt, tries } = findRun(run[1]);
      return {
        id,
        status,
        html_url: nameRunUrl(id),
        updated_at: updatedAt,
        run_attempt: tries.length,
        run_started_at: tries.at(-1),
      };
    }
    throw new Error(`unexpected ${path}`);
  };
  return { github: /** @type {any} */ (github), asked };
}

const TONIGHT = new Date("2026-10-10T07:40:00Z");

/**
 * @param {FakeArtifact[]} artifacts
 * @param {import("../worker/report-flaky-tests.mjs").CountedArtifact[]} [counted]
 */
const listUncountedIds = async (artifacts, counted = []) => {
  const { github } = createFakeRunsApi({
    ciRuns: [
      { id: 1, updated_at: "2026-10-09T12:00:00Z", tries: ["2026-10-09T11:00:00Z"] },
      {
        id: 3,
        updated_at: "2026-10-09T14:00:00Z",
        tries: ["2026-10-09T13:00:00Z"],
        head_repository_id: 99,
      },
    ],
    artifacts,
  });
  const found = await listUncountedArtifacts(github, { counted, now: TONIGHT });
  return found.map(({ id }) => id);
};

test("a night takes each report and burn-in list this repository's CI runs made in the table's week that it hasn't counted", async () => {
  const ids = await listUncountedIds(
    [
      { id: 11, name: "browser-report-3", created_at: "2026-10-09T12:00:00Z", run: 1 },
      { id: 12, name: "burn-in-flaky-2", created_at: "2026-10-04T00:00:00Z", run: 1 },
      { id: 13, name: "ci-passed-abc", created_at: "2026-10-09T12:00:00Z", run: 1 },
      { id: 14, name: "browser-report-1", created_at: "2026-10-09T12:00:00Z", run: 3 },
      { id: 15, name: "browser-report-1", created_at: "2026-10-03T23:59:59Z", run: 1 },
      { id: 16, name: "browser-report-webkit", created_at: "2026-10-09T12:00:00Z", run: 1 },
    ],
    [{ id: 16, at: "2026-10-09T12:00:00Z" }],
  );
  assert.deepEqual(ids, [11, 12]);
});

test("a night reads every page of the repository's artifacts, whatever their order, and takes each once", async () => {
  const artifacts = Array.from({ length: 400 }, (_, index) => ({
    id: index,
    name: "browser-report-1",
    created_at: new Date(TONIGHT.getTime() - (399 - index) * 3600000).toISOString(),
    run: 1,
  }));
  // As one made while the pages are read pushes the one before it onto the next page too.
  artifacts.splice(300, 0, artifacts[299]);
  const { github, asked } = createFakeRunsApi({
    ciRuns: [{ id: 1, updated_at: "2026-10-09T12:00:00Z", tries: ["2026-10-09T11:00:00Z"] }],
    artifacts,
  });

  const found = await listUncountedArtifacts(github, { counted: [], now: TONIGHT });

  assert.equal(found.length, 152);
  assert.equal(new Set(found.map(({ id }) => id)).size, 152);
  assert.deepEqual(
    asked,
    [1, 2, 3, 4, 5].map((page) => `/actions/artifacts?per_page=100&page=${page}`),
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

/** @typedef {import("../worker/report-flaky-tests.mjs").FlakyRun} FlakyRun */
/** @typedef {import("../worker/report-flaky-tests.mjs").CountedArtifact} CountedArtifact */

/**
 * Downloads that hand each try a folder of its artifacts, each in a folder of its own, keeping
 * each try asked for.
 * @param {Record<number, Record<string, unknown>>} filesById each artifact's files, by path in it
 */
function createFakeDownloads(filesById) {
  /** @type {FlakyRun[]} */
  const downloaded = [];
  /** @param {FlakyRun} run */
  const download = (run) => {
    downloaded.push(run);
    const files = run.artifacts.flatMap(({ id }) =>
      Object.entries(filesById[id] ?? {}).map(([path, content]) => [`${id}/${path}`, content]),
    );
    return writeRunFolder(Object.fromEntries(files));
  };
  return { download, downloaded };
}

const UNCOUNTED = { counted: [], countedBefore: 0 };

/** @param {FlakyRun[]} runs */
const listTries = (runs) =>
  runs.map(({ id, artifacts }) => [id, artifacts.map((artifact) => artifact.id)]);

/**
 * @param {object} night
 * @param {ReturnType<typeof createFakeRunsApi>["github"]} night.github
 * @param {ReturnType<typeof createFakeDownloads>["download"]} night.download
 * @param {import("../worker/report-flaky-tests.mjs").Ledger} [night.ledger]
 * @param {Date} [night.now]
 * @param {any[]} [night.nightReports]
 */
const collect = ({ github, download, ledger = UNCOUNTED, now = TONIGHT, nightReports = [] }) =>
  collectFailedTests({ nightReports, github, night: { url: RUN_URL, now }, ledger, download });

/**
 * The body a night's report writes to the open issue with this body.
 * @param {object} night
 * @param {string} night.body
 * @param {import("../worker/report-flaky-tests.mjs").TestRuns[]} night.failed
 * @param {CountedArtifact[]} night.counted
 * @param {Date} night.now
 */
async function postNight({ body, failed, counted, now }) {
  const github = createFakeGitHub([{ number: 5, title: ISSUE_TITLE, body }]);
  await postReport({
    repository: REPOSITORY,
    failed,
    counted,
    runUrl: RUN_URL,
    now,
    fetchImpl: github.fetchImpl,
    env: { GH_TOKEN: "token" },
  });
  return github.written[0].body.body;
}

const RETRY_PASSED_REPORT = { "test-results/report.json": retriedReport([retryPassedSpec]) };
const BROKEN_REPORT = { "test-results/report.json": retriedReport([failedBothTriesSpec]) };
const BURN_IN_LIST = { "burn-in-flaky.json": [BURN_IN_FLAKY] };
const OPEN_BODY = renderTable([tableRow({ name: AT_REST, lastSeen: "2026-10-09" })]);
const ONE_REPORT = {
  ciRuns: [{ id: 1, updated_at: "2026-10-09T12:00:00Z", tries: ["2026-10-09T11:00:00Z"] }],
  artifacts: [{ id: 11, name: "browser-report-1", created_at: "2026-10-09T11:30:00Z", run: 1 }],
};
const NEXT_NIGHT = new Date("2026-10-11T07:40:00Z");

test("a failed download leaves the whole try uncounted while other runs and tonight report, then retries it once", async () => {
  const state = {
    ciRuns: [
      { id: 1, updated_at: "2026-10-09T12:00:00Z", tries: ["2026-10-09T11:00:00Z"] },
      { id: 2, updated_at: "2026-10-09T14:00:00Z", tries: ["2026-10-09T13:00:00Z"] },
      { id: 3, updated_at: "2026-10-09T16:00:00Z", tries: ["2026-10-09T15:00:00Z"] },
    ],
    artifacts: [
      { id: 11, name: "browser-report-1", created_at: "2026-10-09T11:30:00Z", run: 1 },
      { id: 21, name: "browser-report-1", created_at: "2026-10-09T13:30:00Z", run: 2 },
      { id: 22, name: "browser-report-2", created_at: "2026-10-09T13:35:00Z", run: 2 },
      { id: 31, name: "burn-in-flaky-1", created_at: "2026-10-09T15:30:00Z", run: 3 },
    ],
  };
  const { download, downloaded } = createFakeDownloads({
    11: RETRY_PASSED_REPORT,
    21: RETRY_PASSED_REPORT,
    22: BROKEN_REPORT,
    31: BURN_IN_LIST,
  });
  const first = await collect({
    github: createFakeRunsApi(state).github,
    nightReports: [nightReport],
    download: (run) => {
      const directory = download(run);
      if (run.id === 2) throw new Error("HTTP 503 downloading the second shard");
      return directory;
    },
  });

  assert.deepEqual(
    first.counted.map(({ id }) => id),
    [11, 31],
  );
  assert.deepEqual(
    first.skipped.map(({ id, artifacts }) => [id, artifacts.map(({ id }) => id)]),
    [[2, [21, 22]]],
  );
  assert.deepEqual(
    Object.fromEntries(first.failed.map(({ name, foundIn }) => [name, foundIn?.url])),
    {
      [LAST_DRAWN]: RUN_URL,
      [AT_REST]: RUN_URL,
      [RETRY_PASSED]: nameRunUrl(1),
      [BURN_IN_FLAKY.name]: nameRunUrl(3),
    },
  );
  const stale = tableRow({ name: "stale test", lastSeen: "2026-10-01" });
  const body = await postNight({ body: renderTable([stale]), ...first, now: TONIGHT });
  assert.ok(!readTable(body).some(({ name }) => name === stale.name));
  assert.deepEqual(readCounted(body), first.counted);

  const second = await collect({
    github: createFakeRunsApi(state).github,
    download,
    ledger: readLedger({ body, updated_at: TONIGHT.toISOString() }),
    now: NEXT_NIGHT,
  });
  assert.deepEqual(second.failed, [], "the recovered shard makes this a broken try, not flaky");
  assert.deepEqual(second.skipped, []);
  assert.deepEqual(
    second.counted.map(({ id }) => id),
    [21, 22],
  );
  assert.deepEqual(listTries(downloaded), [
    [1, [11]],
    [2, [21, 22]],
    [3, [31]],
    [2, [21, 22]],
  ]);
  const nextBody = await postNight({ body, ...second, now: NEXT_NIGHT });
  assert.equal(readTable(nextBody).find(({ name }) => name === RETRY_PASSED)?.failures, 1);
  assert.deepEqual(
    await collect({
      github: createFakeRunsApi(state).github,
      download,
      ledger: readLedger({ body: nextBody, updated_at: NEXT_NIGHT.toISOString() }),
      now: NEXT_NIGHT,
    }),
    { failed: [], counted: [], skipped: [] },
  );
  assert.equal(downloaded.length, 4);
});

test("when every CI download fails the nightly results can still prune and update the table", async () => {
  const result = await collect({
    github: createFakeRunsApi(ONE_REPORT).github,
    nightReports: [nightReport],
    download: () => {
      throw new Error("HTTP 503");
    },
  });
  assert.deepEqual(result.counted, []);
  assert.deepEqual(
    result.skipped.map(({ id }) => id),
    [1],
  );
  assert.deepEqual(
    result.failed.map(({ name }) => name),
    [LAST_DRAWN, AT_REST],
  );
  const body = await postNight({
    body: renderTable([tableRow({ name: "stale test", lastSeen: "2026-10-01" })]),
    ...result,
    now: TONIGHT,
  });
  assert.deepEqual(
    readTable(body).map(({ name }) => name),
    [LAST_DRAWN, AT_REST],
  );
  assert.deepEqual(readCounted(body), []);
});

test("the nightly command posts before failing skipped downloads, reports the cause, and closes the artifact descriptor", () => {
  const directory = mkdtempSync(join(tmpdir(), "nightly-command-"));
  const preload = join(directory, "preload.mjs");
  const report = join(directory, "report.json");
  const written = join(directory, "written.json");
  const issue = {
    number: 5,
    title: ISSUE_TITLE,
    body: renderTable([tableRow({ name: "stale test", lastSeen: "2000-01-01" })]),
  };
  writeFileSync(report, JSON.stringify(nightReport));
  writeFileSync(
    preload,
    `import childProcess from "node:child_process";
import { fstatSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

let descriptor;
childProcess.execFileSync = (command, args, options) => {
  if (command !== "gh") throw new Error("unexpected command");
  descriptor = options.stdio[1];
  throw new Error("artifact download unavailable");
};
syncBuiltinESMExports();
process.on("exit", () => {
  try {
    fstatSync(descriptor);
    console.error("artifact descriptor left open");
    process.exitCode = 2;
  } catch (error) {
    if (error.code !== "EBADF") throw error;
    console.log("artifact descriptor closed");
  }
});

const now = new Date().toISOString();
globalThis.fetch = async (url, init) => {
  const { pathname } = new URL(url);
  if (pathname.endsWith("/issues")) return Response.json([${JSON.stringify(issue)}]);
  if (pathname.endsWith("/actions/artifacts")) return Response.json({ artifacts: [{
    id: 11, name: "browser-report-1", created_at: now, expired: false,
    workflow_run: { id: 1, repository_id: 1, head_repository_id: 1 }
  }] });
  if (pathname.endsWith("/actions/runs/1")) return Response.json({
    status: "completed", html_url: ${JSON.stringify(nameRunUrl(1))},
    updated_at: now, run_attempt: 1, run_started_at: now
  });
  if (pathname.endsWith("/issues/5") && init.method === "PATCH") {
    writeFileSync(${JSON.stringify(written)}, init.body);
    return Response.json({ number: 5 });
  }
  if (pathname.endsWith("/issues/5/comments")) return Response.json({});
  throw new Error("unexpected API request");
};
`,
  );
  const script = fileURLToPath(new URL("../worker/report-flaky-tests.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", preload, script, report], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_REPOSITORY: REPOSITORY, RUN_URL },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Updated #5:/);
  assert.match(result.stdout, /artifact descriptor closed/);
  assert.match(result.stderr, /CI run 1's artifacts \(11\).*artifact download unavailable/);
  const { body } = JSON.parse(readFileSync(written, "utf8"));
  assert.deepEqual(
    readTable(body).map(({ name }) => name),
    [LAST_DRAWN, AT_REST],
  );
  assert.deepEqual(readCounted(body), []);
});

test("a run tried again before a night judges each try on its own, and counts its first try's report once", async () => {
  const { github } = createFakeRunsApi({
    ciRuns: [
      {
        id: 8,
        updated_at: "2026-10-09T09:40:00Z",
        tries: ["2026-10-09T06:00:00Z", "2026-10-09T09:00:00Z"],
      },
    ],
    artifacts: [
      { id: 81, name: "browser-report-1", created_at: "2026-10-09T06:30:00Z", run: 8 },
      { id: 82, name: "browser-report-1", created_at: "2026-10-09T09:30:00Z", run: 8 },
      { id: 83, name: "burn-in-flaky-1", created_at: "2026-10-09T09:35:00Z", run: 8 },
    ],
  });
  const { download, downloaded } = createFakeDownloads({
    81: RETRY_PASSED_REPORT,
    82: BROKEN_REPORT,
    83: BURN_IN_LIST,
  });

  const { failed, counted } = await collect({ github, download });

  assert.deepEqual(listTries(downloaded), [
    [8, [81]],
    [8, [82, 83]],
  ]);
  assert.deepEqual(
    failed.map(({ name, runs, failures }) => [name, runs, failures]),
    [
      [BURN_IN_FLAKY.name, 10, 2],
      [RETRY_PASSED, 2, 1],
    ],
  );
  assert.deepEqual(counted.map(({ id }) => id).toSorted(), [81, 82, 83]);
});

test("a run tried again days after it began is found, and only its new try is counted", async () => {
  const { github, asked } = createFakeRunsApi({
    ciRuns: [
      {
        id: 9,
        updated_at: "2026-10-09T10:40:00Z",
        tries: ["2026-10-04T10:00:00Z", "2026-10-09T10:00:00Z"],
      },
    ],
    artifacts: [
      { id: 91, name: "browser-report-1", created_at: "2026-10-04T10:30:00Z", run: 9 },
      { id: 92, name: "browser-report-1", created_at: "2026-10-09T10:30:00Z", run: 9 },
    ],
  });
  const { download, downloaded } = createFakeDownloads({ 92: RETRY_PASSED_REPORT });

  const { failed, counted } = await collect({
    github,
    download,
    ledger: { counted: [{ id: 91, at: "2026-10-04T10:30:00Z" }], countedBefore: 0 },
  });

  assert.deepEqual(listTries(downloaded), [[9, [92]]]);
  assert.deepEqual(
    failed.map(({ name, foundIn }) => [name, foundIn]),
    [[RETRY_PASSED, { url: nameRunUrl(9), at: "2026-10-09T10:40:00Z" }]],
  );
  assert.deepEqual(counted, [{ id: 92, at: "2026-10-09T10:30:00Z" }]);
  assert.ok(asked.every((path) => !path.includes("created")));
});

test("an artifact the table has counted is never counted again", async () => {
  const { download, downloaded } = createFakeDownloads({ 11: RETRY_PASSED_REPORT });
  const first = await collect({ github: createFakeRunsApi(ONE_REPORT).github, download });
  const body = await postNight({ body: OPEN_BODY, ...first, now: TONIGHT });

  const second = await collect({
    github: createFakeRunsApi(ONE_REPORT).github,
    download,
    ledger: readLedger({ body, updated_at: TONIGHT.toISOString() }),
    now: NEXT_NIGHT,
  });
  const nextBody = await postNight({ body, ...second, now: NEXT_NIGHT });

  assert.deepEqual(listTries(downloaded), [[1, [11]]]);
  assert.deepEqual(second, { failed: [], counted: [], skipped: [] });
  assert.deepEqual(readCounted(nextBody), [{ id: 11, at: "2026-10-09T11:30:00Z" }]);
  assert.equal(readTable(nextBody).find((row) => row.name === RETRY_PASSED)?.failures, 1);
});

test("a night whose report doesn't land leaves its artifacts to the next night", async () => {
  const { download, downloaded } = createFakeDownloads({ 11: RETRY_PASSED_REPORT });
  const issues = [{ number: 5, title: ISSUE_TITLE, body: OPEN_BODY }];
  /** @type {typeof fetch} */
  const failingWrites = async (_url, init) =>
    (init?.method ?? "GET") === "GET" ? Response.json(issues) : new Response("", { status: 502 });
  const first = await collect({ github: createFakeRunsApi(ONE_REPORT).github, download });
  await assert.rejects(
    postReport({
      repository: REPOSITORY,
      ...first,
      runUrl: RUN_URL,
      now: TONIGHT,
      fetchImpl: failingWrites,
      env: { GH_TOKEN: "token" },
    }),
    /GitHub answered 502/,
  );

  const second = await collect({
    github: createFakeRunsApi(ONE_REPORT).github,
    download,
    ledger: readLedger({ ...issues[0], updated_at: "2026-10-09T07:40:00Z" }),
    now: NEXT_NIGHT,
  });

  assert.deepEqual(listTries(downloaded), [
    [1, [11]],
    [1, [11]],
  ]);
  assert.deepEqual(
    second.failed.map(({ name }) => name),
    [RETRY_PASSED],
  );
});

test("a run still going waits, and once it ends its try's reports are judged together", async () => {
  const shard1 = { id: 101, name: "browser-report-1", created_at: "2026-10-10T07:30:00Z", run: 10 };
  const shard2 = { id: 102, name: "browser-report-2", created_at: "2026-10-10T07:50:00Z", run: 10 };
  const tries = ["2026-10-10T07:00:00Z"];
  const { download, downloaded } = createFakeDownloads({
    101: RETRY_PASSED_REPORT,
    102: BROKEN_REPORT,
  });
  const going = createFakeRunsApi({
    ciRuns: [{ id: 10, tries, status: "in_progress", updated_at: "2026-10-10T07:30:00Z" }],
    artifacts: [shard1],
  });
  assert.deepEqual(await collect({ github: going.github, download }), {
    failed: [],
    counted: [],
    skipped: [],
  });

  const ended = createFakeRunsApi({
    ciRuns: [{ id: 10, tries, updated_at: "2026-10-10T07:55:00Z" }],
    artifacts: [shard1, shard2],
  });
  const next = await collect({ github: ended.github, download, now: NEXT_NIGHT });

  assert.deepEqual(listTries(downloaded), [[10, [101, 102]]]);
  assert.deepEqual(next.failed, []);
  assert.deepEqual(next.counted.map(({ id }) => id).toSorted(), [101, 102]);
});

test("the issue's list of counted artifacts keeps those made in the table's week, with the night's", async () => {
  const body = renderTable(
    [tableRow({ name: AT_REST, lastSeen: "2026-10-09" })],
    [
      { id: 1, at: "2026-10-03T23:59:59Z" },
      { id: 2, at: "2026-10-04T00:00:00Z" },
    ],
  );

  const written = await postNight({
    body,
    failed: [],
    counted: [{ id: 3, at: "2026-10-09T12:00:00Z" }],
    now: TONIGHT,
  });

  assert.deepEqual(readCounted(written), [
    { id: 2, at: "2026-10-04T00:00:00Z" },
    { id: 3, at: "2026-10-09T12:00:00Z" },
  ]);
  assert.deepEqual(readCounted(null), []);
});

test("a night's report holds its own tests, found in it, and each CI run's it counted, found in theirs", async () => {
  const { github } = createFakeRunsApi({
    ciRuns: [
      { id: 1, updated_at: "2026-10-09T12:00:00Z", tries: ["2026-10-09T11:00:00Z"] },
      { id: 7, updated_at: "2026-10-09T18:00:00Z", tries: ["2026-10-09T17:00:00Z"] },
    ],
    artifacts: [
      { id: 11, name: "browser-report-3", created_at: "2026-10-09T11:30:00Z", run: 1 },
      { id: 71, name: "burn-in-flaky-1", created_at: "2026-10-09T17:30:00Z", run: 7 },
    ],
  });
  const { download } = createFakeDownloads({ 11: RETRY_PASSED_REPORT, 71: BURN_IN_LIST });

  const { failed } = await collect({ github, download, nightReports: [nightReport] });

  assert.deepEqual(Object.fromEntries(failed.map(({ name, foundIn }) => [name, foundIn?.url])), {
    [LAST_DRAWN]: RUN_URL,
    [AT_REST]: RUN_URL,
    [RETRY_PASSED]: nameRunUrl(1),
    [BURN_IN_FLAKY.name]: nameRunUrl(7),
  });
});

test("the first night after the issue's body lists what it counted takes each artifact made before the issue's last edit as counted", async () => {
  const issue = {
    body: OPEN_BODY.replace(/\n<!-- flaky-counted .*? -->/, ""),
    updated_at: "2026-10-09T08:00:00Z",
  };
  const state = {
    ciRuns: [
      { id: 1, updated_at: "2026-10-09T07:40:00Z", tries: ["2026-10-09T07:00:00Z"] },
      { id: 2, updated_at: "2026-10-09T09:40:00Z", tries: ["2026-10-09T09:00:00Z"] },
    ],
    artifacts: [
      { id: 11, name: "browser-report-1", created_at: "2026-10-09T07:30:00Z", run: 1 },
      { id: 21, name: "browser-report-1", created_at: "2026-10-09T09:30:00Z", run: 2 },
    ],
  };
  const { download, downloaded } = createFakeDownloads({
    11: RETRY_PASSED_REPORT,
    21: RETRY_PASSED_REPORT,
  });
  const ledger = readLedger(issue);
  assert.deepEqual(ledger, { counted: [], countedBefore: Date.parse(issue.updated_at) });

  const first = await collect({ github: createFakeRunsApi(state).github, download, ledger });
  const body = await postNight({ body: issue.body, ...first, now: TONIGHT });
  const second = await collect({
    github: createFakeRunsApi(state).github,
    download,
    ledger: readLedger({ body, updated_at: TONIGHT.toISOString() }),
    now: NEXT_NIGHT,
  });

  assert.deepEqual(listTries(downloaded), [[2, [21]]]);
  assert.equal(first.failed.find(({ name }) => name === RETRY_PASSED)?.failures, 1);
  assert.deepEqual(
    readCounted(body).map(({ id }) => id),
    [11, 21],
  );
  assert.deepEqual(second, { failed: [], counted: [], skipped: [] });
  assert.deepEqual(readLedger({ body, updated_at: TONIGHT.toISOString() }).countedBefore, 0);
  assert.deepEqual(readLedger(undefined), UNCOUNTED);
});
