// Keeps one open issue that names each browser test that failed only some of the time, so it's
// found and fixed rather than retried past on pull requests. Each night it adds main's nightly run
// (with no retry, .github/workflows/flaky.yml), and the CI runs that finished since the last night
// that reported: pull requests' runs where a retry passed, and burn-in's runs of tests a pull
// request didn't write or edit (worker/judge-burn-in.mjs), from the artifacts CI keeps. The issue's
// body is one table, one row a test, that only the nightly run writes, so no two writes ever race
// and no run's report is lost; a comment names each test new to it, and starts the routine that
// fixes the table's top test; a row goes once its test hasn't failed for a week, and the issue
// closes once no row is left.
// Usage: node worker/report-flaky-tests.mjs <the nightly run's report.json files>
// with GH_TOKEN, GH_REPO, RUN_URL, GITHUB_REPOSITORY, and GITHUB_RUN_ID set, as Actions sets the
// last two.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";

export const ISSUE_TITLE = "Flaky browser tests";

const DAYS_KEPT = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const NIGHTLY_WORKFLOW = "flaky.yml";
const REPORT_JOB = "report";
const NIGHTS_LOOKED_BACK = 10;
// A CI run ends within hours of starting, so one started a day before a window can't end in it.
const LONGEST_RUN_MS = DAY_MS;
// CI keeps a run's report only when a test needed its retry or failed, and burn-in's list only when
// it named a test.
const RUN_ARTIFACT = /^(?:browser-report|burn-in-flaky)-/;
const ROUTINE_TIMEOUT_MS = 10000;
const FAILED_STATUSES = new Set(["failed", "timedOut"]);
const STATE_PATTERN = /<!-- flaky-tests (.*?) -->/s;

/** @typedef {{ name: string, runs: number, failures: number, message: string }} TestRuns */
/** @typedef {TestRuns & { firstSeen: string, lastSeen: string, lastRun: string }} TableRow */

// Playwright colors its messages for a terminal.
const ESCAPE = String.fromCharCode(27);
const COLOR_CODE = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g");

/** @param {string | undefined} message */
export const readFirstLine = (message) =>
  (message ?? "").replace(COLOR_CODE, "").trim().split("\n")[0];

/**
 * Each test in a Playwright JSON report, with the titles of the describe blocks around it.
 * @param {any} suite
 * @param {string[]} titles
 * @returns {Generator<{ spec: any, test: any, titles: string[] }>}
 */
function* listReportTests(suite, titles) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) yield { spec, test, titles };
  }
  for (const inner of suite.suites ?? []) yield* listReportTests(inner, [...titles, inner.title]);
}

/**
 * @param {{ spec: any, test: any, titles: string[] }} entry
 */
const nameTest = ({ spec, test, titles }) =>
  `[${test.projectName}] ${spec.file}:${spec.line} > ${[...titles, spec.title].join(" > ")}`;

/** @param {any} result */
const isFailed = (result) => FAILED_STATUSES.has(result.status);

/**
 * Each test in Playwright JSON reports, with the titles of the describe blocks around it.
 * @param {any[]} reports
 */
const listReportsTests = (reports) =>
  reports.flatMap((report) =>
    (report.suites ?? []).flatMap((/** @type {any} */ top) => [...listReportTests(top, [])]),
  );

/** @param {any} test */
const isFailedEveryTry = (test) => (test.results ?? []).length > 0 && test.results.every(isFailed);

/**
 * Each test that failed in any of its runs across the reports, the most failed first. A test run
 * many times over appears once for each run. A retried run where some test failed every try
 * names none: its change broke that test, and likely the ones a retry passed too, and the nightly
 * run still finds any that only fail some of the time.
 * @param {any[]} reports Playwright JSON reports
 * @param {{ isRetried?: boolean }} [options] whether the run retried a failed test
 * @returns {TestRuns[]}
 */
export function listFailedTests(reports, { isRetried = false } = {}) {
  const tests = listReportsTests(reports);
  if (isRetried && tests.some(({ test }) => isFailedEveryTry(test))) return [];
  /** @type {Map<string, TestRuns>} */
  const byName = new Map();
  for (const entry of tests) {
    const name = nameTest(entry);
    const counted = byName.get(name) ?? { name, runs: 0, failures: 0, message: "" };
    for (const result of entry.test.results ?? []) {
      counted.runs += 1;
      if (!isFailed(result)) continue;
      counted.failures += 1;
      counted.message ||= readFirstLine(result.error?.message);
    }
    byName.set(name, counted);
  }
  return [...byName.values()]
    .filter((counted) => counted.failures > 0)
    .sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name));
}

/**
 * The tests of several lists of failed tests, each test's runs and failures added up, the most
 * failed first.
 * @param {TestRuns[][]} lists
 * @returns {TestRuns[]}
 */
export function mergeFailedTests(lists) {
  /** @type {Map<string, TestRuns>} */
  const byName = new Map();
  for (const test of lists.flat()) {
    const counted = byName.get(test.name);
    byName.set(test.name, {
      name: test.name,
      runs: (counted?.runs ?? 0) + test.runs,
      failures: (counted?.failures ?? 0) + test.failures,
      message: counted?.message || test.message,
    });
  }
  return [...byName.values()].sort(
    (a, b) => b.failures - a.failures || a.name.localeCompare(b.name),
  );
}

/**
 * The issue's rows, from the state its body keeps.
 * @param {string | null | undefined} body
 * @returns {TableRow[]}
 */
export function readTable(body) {
  const state = (body ?? "").match(STATE_PATTERN)?.[1];
  return state ? JSON.parse(state) : [];
}

/**
 * Adds a report's failed tests to the table and drops each row whose test hasn't failed for a
 * week, the most failed first.
 * @param {TableRow[]} table
 * @param {TestRuns[]} failed
 * @param {{ day: string, runUrl: string }} report the report's day, as YYYY-MM-DD, and its run
 * @returns {TableRow[]}
 */
export function addToTable(table, failed, { day, runUrl }) {
  const byName = new Map(table.map((row) => [row.name, row]));
  for (const test of failed) {
    const row = byName.get(test.name);
    byName.set(test.name, {
      name: test.name,
      runs: (row?.runs ?? 0) + test.runs,
      failures: (row?.failures ?? 0) + test.failures,
      message: test.message || row?.message || "",
      firstSeen: row?.firstSeen ?? day,
      lastSeen: day,
      lastRun: runUrl,
    });
  }
  const oldestKept = new Date(Date.parse(day) - (DAYS_KEPT - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return [...byName.values()]
    .filter((row) => row.lastSeen >= oldestKept)
    .sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name));
}

/** @param {string} text */
const escapeCode = (text) => text.replaceAll("|", "\\|").replaceAll("`", "'");

/** @param {string} text */
const escapeText = (text) =>
  escapeCode(text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));

/**
 * The issue's body: the table, and the state the next report reads it back from.
 * @param {TableRow[]} table
 */
export const renderTable = (table) =>
  [
    `Each browser test that failed only some of the time, in main's nightly runs with no retry or in a pull request's run where its retry passed. A test leaves the table once it hasn't failed for ${DAYS_KEPT} days, and the issue closes once none is left.`,
    "",
    "| Test | Failed | First seen | Last seen | First line of its last error |",
    "| --- | --- | --- | --- | --- |",
    ...table.map(
      (row) =>
        `| \`${escapeCode(row.name)}\` | ${row.failures} of ${row.runs} runs | ${row.firstSeen} | [${row.lastSeen}](${row.lastRun}) | ${escapeText(row.message) || "no message"} |`,
    ),
    "",
    // An error's own text could close the comment early.
    `<!-- flaky-tests ${JSON.stringify(table).replaceAll(">", "\\u003e")} -->`,
  ].join("\n");

/**
 * @param {TestRuns[]} added the tests new to the table
 * @param {string} runUrl
 */
export const renderNewTests = (added, runUrl) =>
  [
    `[This run](${runUrl}) found ${added.length === 1 ? "a test" : `${added.length} tests`} new to the table:`,
    "",
    ...added.map((test) => `- \`${test.name}\`: ${test.message || "no message"}`),
  ].join("\n");

/**
 * Starts the routine that fixes the table's top flaky test, so a test new to the table is fixed
 * the day it's found rather than at the routine's next scheduled run. It runs only where the
 * routine's API trigger is set: its URL and token, which Actions keeps as secrets.
 * @param {object} options
 * @param {TestRuns[]} options.added the tests new to the table
 * @param {string} options.runUrl
 * @param {typeof fetch} options.fetchImpl
 * @param {NodeJS.ProcessEnv} options.env
 * @returns {Promise<string>} what it did, for the log
 */
export async function startFixRoutine({ added, runUrl, fetchImpl, env }) {
  if (!env.FLAKY_ROUTINE_URL || !env.FLAKY_ROUTINE_TOKEN) return "No fix routine is set up.";
  // The issue already names the test, so a routine that doesn't answer never fails the report.
  try {
    const response = await fetchImpl(env.FLAKY_ROUTINE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.FLAKY_ROUTINE_TOKEN}`,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: renderNewTests(added, runUrl) }),
      signal: AbortSignal.timeout(ROUTINE_TIMEOUT_MS),
    });
    return response.ok
      ? "Started the fix routine."
      : `The fix routine answered ${response.status}.`;
  } catch (error) {
    return `The fix routine didn't answer: ${error instanceof Error ? error.message : error}.`;
  }
}

/**
 * Adds a run's failed tests to the open issue, opening one if there's none, and closes it once its
 * table is empty.
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {TestRuns[]} options.failed
 * @param {string} options.runUrl
 * @param {Date} [options.now]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<string>} what it did, for the log
 */
export async function postReport({
  repository,
  failed,
  runUrl,
  now = new Date(),
  fetchImpl = fetch,
  env = process.env,
}) {
  const github = createGitHub({ repository, fetchImpl, env });
  const issues = await readAllPages(github, "/issues?state=open");
  const open = issues.find((issue) => issue.title === ISSUE_TITLE && !issue.pull_request);
  if (!open && !failed.length) return "No browser test failed, and no issue is open.";

  const day = now.toISOString().slice(0, 10);
  const table = readTable(open?.body);
  const updated = addToTable(table, failed, { day, runUrl });
  const body = renderTable(updated);
  if (!open) {
    const created = await github("/issues", { method: "POST", body: { title: ISSUE_TITLE, body } });
    const started = await startFixRoutine({ added: failed, runUrl, fetchImpl, env });
    return `Opened #${created.number} naming ${failed.length} tests. ${started}`;
  }

  const known = new Set(table.map((row) => row.name));
  const added = failed.filter((test) => !known.has(test.name));
  if (!updated.length) {
    await github(`/issues/${open.number}`, {
      method: "PATCH",
      body: { body, state: "closed", state_reason: "completed" },
    });
    return `Closed #${open.number}: no browser test has failed for ${DAYS_KEPT} days.`;
  }
  await github(`/issues/${open.number}`, { method: "PATCH", body: { body } });
  if (!added.length) {
    return `Updated #${open.number}: ${failed.length} tests failed, none new.`;
  }
  await github(`/issues/${open.number}/comments`, {
    method: "POST",
    body: { body: renderNewTests(added, runUrl) },
  });
  const started = await startFixRoutine({ added, runUrl, fetchImpl, env });
  return `Updated #${open.number}: ${failed.length} tests failed, ${added.length} new. ${started}`;
}

/** @typedef {ReturnType<typeof createGitHub>} GitHub */
/** @typedef {{ id: number, names: string[] }} FlakyRun */

/**
 * When a job of a run began, or null when the run has no such job.
 * @param {GitHub} github
 * @param {number | string} runId
 * @param {(job: any) => boolean} isWanted
 */
async function findJobStart(github, runId, isWanted) {
  const { jobs } = await github(`/actions/runs/${runId}/jobs?per_page=100`);
  const job = jobs.find(isWanted);
  return job?.started_at ? new Date(job.started_at) : null;
}

/** @param {any} job */
const isReport = (job) => job.name === REPORT_JOB;

/**
 * The CI runs this night's report takes: those that finished from when the last night's report
 * that went through began, until this one began. A night whose report failed leaves its runs to
 * the next, and with no such night it looks back over the days the table keeps.
 * @param {GitHub} github
 * @param {{ runId: string, now: Date }} night
 * @returns {Promise<{ since: Date, until: Date }>}
 */
export async function findReportWindow(github, { runId, now }) {
  const until = (await findJobStart(github, runId, isReport)) ?? now;
  const { workflow_runs: nights } = await github(
    `/actions/workflows/${NIGHTLY_WORKFLOW}/runs?event=schedule&per_page=${NIGHTS_LOOKED_BACK}`,
  );
  for (const night of nights) {
    if (String(night.id) === String(runId)) continue;
    const since = await findJobStart(
      github,
      night.id,
      (job) => isReport(job) && job.conclusion === "success",
    );
    if (since) return { since, until };
  }
  return { since: new Date(until.getTime() - DAYS_KEPT * DAY_MS), until };
}

/**
 * Whether a CI run finished from `since` until `until`, from a branch of this repository: a
 * fork's run could hand the table anything.
 * @param {any} run
 * @param {{ since: Date, until: Date }} window
 */
const isRunToReport = (run, { since, until }) =>
  run.status === "completed" &&
  run.head_repository?.id === run.repository?.id &&
  Date.parse(run.updated_at) >= since.getTime() &&
  Date.parse(run.updated_at) < until.getTime();

/**
 * Each CI run in the window that kept a report or burn-in's list, with those artifacts' names.
 * @param {GitHub} github
 * @param {{ since: Date, until: Date }} window
 * @returns {Promise<FlakyRun[]>}
 */
export async function listFlakyRuns(github, window) {
  const earliest = new Date(window.since.getTime() - LONGEST_RUN_MS).toISOString();
  const runs = await readAllPages(
    async (path) => (await github(path)).workflow_runs,
    `/actions/workflows/ci.yml/runs?status=completed&created=>=${earliest}`,
  );
  const flakyRuns = [];
  for (const run of runs.filter((candidate) => isRunToReport(candidate, window))) {
    const { artifacts } = await github(`/actions/runs/${run.id}/artifacts?per_page=100`);
    const names = artifacts
      .filter((artifact) => !artifact.expired && RUN_ARTIFACT.test(artifact.name))
      .map((artifact) => artifact.name);
    if (names.length) flakyRuns.push({ id: run.id, names });
  }
  return flakyRuns;
}

/**
 * Every file of a name under a folder, read as JSON.
 * @param {string} directory
 * @param {string} name
 */
const readJsonFiles = (directory, name) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === name)
    .map((entry) => JSON.parse(readFileSync(join(entry.parentPath, entry.name), "utf8")));

/**
 * The tests a CI run's kept artifacts name: each its retry passed, unless a test failed every
 * try, and each burn-in found failing that the pull request didn't write.
 * @param {string} directory the run's artifacts, each in a folder of its own
 * @returns {TestRuns[]}
 */
export const readRunFailures = (directory) =>
  mergeFailedTests([
    listFailedTests(readJsonFiles(directory, "report.json"), { isRetried: true }),
    ...readJsonFiles(directory, "burn-in-flaky.json"),
  ]);

/**
 * A CI run's artifacts, each in a folder of its own, downloaded by GitHub's CLI from the
 * repository GH_REPO names.
 * @param {FlakyRun} run
 * @returns {string} the folder that holds them
 */
function downloadRun({ id, names }) {
  const directory = mkdtempSync(join(tmpdir(), `ci-run-${id}-`));
  execFileSync("gh", [
    "run",
    "download",
    String(id),
    "--dir",
    directory,
    ...names.flatMap((name) => ["--name", name]),
  ]);
  return directory;
}

/**
 * The tests that failed in the nightly run and in each CI run its window takes.
 * @param {object} options
 * @param {any[]} options.nightReports the nightly run's own Playwright JSON reports
 * @param {GitHub} options.github
 * @param {{ runId: string, now: Date }} options.night
 * @param {(run: FlakyRun) => string} [options.download]
 */
export async function collectFailedTests({ nightReports, github, night, download = downloadRun }) {
  const window = await findReportWindow(github, night);
  const runs = await listFlakyRuns(github, window);
  return mergeFailedTests([
    listFailedTests(nightReports),
    ...runs.map((run) => readRunFailures(download(run))),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repository = String(process.env.GITHUB_REPOSITORY);
  const failed = await collectFailedTests({
    nightReports: process.argv.slice(2).map((path) => JSON.parse(readFileSync(path, "utf8"))),
    github: createGitHub({ repository, fetchImpl: fetch, env: process.env }),
    night: { runId: String(process.env.GITHUB_RUN_ID), now: new Date() },
  });
  console.log(await postReport({ repository, failed, runUrl: String(process.env.RUN_URL) }));
}
