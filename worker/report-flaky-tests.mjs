// Keeps one open issue that names each browser test that failed only some of the time, so it's
// found and fixed rather than retried past on pull requests. Each night it adds main's nightly run
// (with no retry, .github/workflows/flaky.yml), and each report and burn-in list CI's runs made
// that it hasn't counted yet: the reports of pull requests' runs where a retry passed, and
// burn-in's lists of tests a pull request didn't write or edit (worker/judge-burn-in.mjs), each try
// of a run judged as a whole once the run has ended, and each test credited to the run that holds
// its failed try's trace. The issue's body is one table, one row a test, that only the nightly run
// writes, so no two writes ever race, with the list of the artifacts it has counted, so none is
// counted twice and none is lost; a comment names each test new to it, and starts the routine that
// fixes the table's top test; a row goes once its test hasn't failed for a week, and the issue
// closes once no row is left.
// Usage: node worker/report-flaky-tests.mjs <the nightly run's report.json files>
// with GH_TOKEN, GH_REPO, RUN_URL, and GITHUB_REPOSITORY set, as Actions sets the last.
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";

export const ISSUE_TITLE = "Flaky browser tests";

const DAYS_KEPT = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
// CI keeps a run's report only when a test needed its retry or failed, and burn-in's list only when
// it named a test.
const RUN_ARTIFACT = /^(?:browser-report|burn-in-flaky)-/;
const ROUTINE_TIMEOUT_MS = 10000;
const FAILED_STATUSES = new Set(["failed", "timedOut"]);
const STATE_PATTERN = /<!-- flaky-tests (.*?) -->/s;
const COUNTED_PATTERN = /<!-- flaky-counted (.*?) -->/s;

/**
 * When the week the table keeps begins: the start of the earliest day a row stays for, as a time.
 * @param {Date} now
 */
const findWeekStart = (now) =>
  Date.parse(now.toISOString().slice(0, 10)) - (DAYS_KEPT - 1) * DAY_MS;

/** @typedef {{ url: string, at: string }} FoundIn the run a test last failed in, and when it ended */
/** @typedef {{ name: string, runs: number, failures: number, message: string, foundIn?: FoundIn }} TestRuns */
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
 * The later of two runs a test failed in.
 * @param {FoundIn | undefined} first
 * @param {FoundIn | undefined} second
 */
const pickLatestRun = (first, second) =>
  first && (!second || Date.parse(first.at) >= Date.parse(second.at)) ? first : second;

/**
 * The tests of several lists of failed tests, each test's runs and failures added up, with the
 * latest run it failed in, the most failed first.
 * @param {TestRuns[][]} lists
 * @returns {TestRuns[]}
 */
export function mergeFailedTests(lists) {
  /** @type {Map<string, TestRuns>} */
  const byName = new Map();
  for (const test of lists.flat()) {
    const counted = byName.get(test.name);
    const foundIn = pickLatestRun(counted?.foundIn, test.foundIn);
    byName.set(test.name, {
      name: test.name,
      runs: (counted?.runs ?? 0) + test.runs,
      failures: (counted?.failures ?? 0) + test.failures,
      message: counted?.message || test.message,
      ...(foundIn && { foundIn }),
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
 * The CI artifacts the table already counted, from the list the issue's body keeps beside it.
 * @param {string | null | undefined} body
 * @returns {CountedArtifact[]}
 */
export function readCounted(body) {
  const counted = (body ?? "").match(COUNTED_PATTERN)?.[1];
  return counted ? JSON.parse(counted) : [];
}

/**
 * What the open issue has counted: the artifacts its body lists, and the time before which every
 * artifact counts as counted, for a table written before its body listed them.
 * @param {{ body?: string | null, updated_at: string } | undefined} issue
 * @returns {Ledger}
 */
export function readLedger(issue) {
  const body = issue?.body ?? "";
  const isUnlisted = STATE_PATTERN.test(body) && !COUNTED_PATTERN.test(body);
  return {
    counted: readCounted(body),
    countedBefore: issue && isUnlisted ? Date.parse(issue.updated_at) : 0,
  };
}

/**
 * The counted artifacts made in the week the table keeps: an older one isn't looked at again.
 * @param {CountedArtifact[]} counted
 * @param {Date} now
 */
const keepCountedWeek = (counted, now) =>
  counted.filter(({ at }) => Date.parse(at) >= findWeekStart(now));

/**
 * Adds a report's failed tests to the table and drops each row whose test hasn't failed for a
 * week, the most failed first.
 * @param {TableRow[]} table
 * @param {TestRuns[]} failed
 * @param {{ day: string, runUrl: string }} report the report's day, as YYYY-MM-DD, and its run, for
 *   a test that names no run of its own
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
      lastRun: test.foundIn?.url ?? runUrl,
    });
  }
  const oldestKept = new Date(findWeekStart(new Date(day))).toISOString().slice(0, 10);
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
 * The issue's body: the table, and the state the next report reads it back from, with the CI
 * artifacts it has counted.
 * @param {TableRow[]} table
 * @param {CountedArtifact[]} [counted]
 */
export const renderTable = (table, counted = []) =>
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
    `<!-- flaky-counted ${JSON.stringify(counted)} -->`,
  ].join("\n");

/**
 * Each test new to the table, with the run that holds its failed try's trace.
 * @param {TestRuns[]} added the tests new to the table
 * @param {string} runUrl the report's run, for a test that names no run of its own
 */
export const renderNewTests = (added, runUrl) =>
  [
    `Found ${added.length === 1 ? "a test" : `${added.length} tests`} new to the table:`,
    "",
    ...added.map(
      (test) =>
        `- \`${test.name}\`, in [its run](${test.foundIn?.url ?? runUrl}): ${test.message || "no message"}`,
    ),
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
 * The open issue Flaky browser tests, or undefined when none is open.
 * @param {GitHub} github
 */
async function findOpenIssue(github) {
  const issues = await readAllPages(github, "/issues?state=open");
  return issues.find((issue) => issue.title === ISSUE_TITLE && !issue.pull_request);
}

/**
 * Adds a night's failed tests to the open issue, opening one if there's none, and closes it once
 * its table is empty, writing down the CI artifacts the night counted with the table, so a night
 * whose report never lands leaves them to the next. With no issue open, no artifact counted in the
 * week found a failure, so one counted again finds none either.
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {TestRuns[]} options.failed
 * @param {CountedArtifact[]} [options.counted] the CI artifacts the night counted
 * @param {string} options.runUrl
 * @param {Date} [options.now]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<string>} what it did, for the log
 */
export async function postReport({
  repository,
  failed,
  counted = [],
  runUrl,
  now = new Date(),
  fetchImpl = fetch,
  env = process.env,
}) {
  const github = createGitHub({ repository, fetchImpl, env });
  const open = await findOpenIssue(github);
  if (!open && !failed.length) return "No browser test failed, and no issue is open.";

  const day = now.toISOString().slice(0, 10);
  const table = readTable(open?.body);
  const updated = addToTable(table, failed, { day, runUrl });
  const body = renderTable(updated, keepCountedWeek([...readCounted(open?.body), ...counted], now));
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
/** @typedef {{ id: number, at: string }} CountedArtifact a CI artifact and when it was made */
/** @typedef {{ counted: CountedArtifact[], countedBefore: number }} Ledger */
/** @typedef {CountedArtifact & { name: string }} RunArtifact */
/** @typedef {{ id: number, foundIn: FoundIn, artifacts: RunArtifact[] }} FlakyRun one try of a CI run, and the artifacts it made */

/**
 * Whether a night counts an artifact: a report or burn-in's list one of this repository's
 * branches' CI runs made in the week the table keeps, not counted before. A fork's run could hand
 * the table anything.
 * @param {any} artifact
 * @param {{ since: number, counted: Set<number> }} night
 */
const isArtifactToCount = (artifact, { since, counted }) =>
  !artifact.expired &&
  RUN_ARTIFACT.test(artifact.name) &&
  Date.parse(artifact.created_at) >= since &&
  !counted.has(artifact.id) &&
  artifact.workflow_run?.head_repository_id === artifact.workflow_run?.repository_id;

/**
 * Every report and burn-in list CI made in the week the table keeps that it hasn't counted, from
 * every page of the repository's artifacts, so a run tried again days after it began is found. An
 * artifact made while the pages are read can show on two, so each is taken once.
 * @param {GitHub} github
 * @param {{ counted: CountedArtifact[], now: Date }} night
 * @returns {Promise<any[]>}
 */
export async function listUncountedArtifacts(github, { counted, now }) {
  const night = { since: findWeekStart(now), counted: new Set(counted.map(({ id }) => id)) };
  const found = new Map();
  for (let page = 1; ; page += 1) {
    const { artifacts } = await github(`/actions/artifacts?per_page=${PAGE_SIZE}&page=${page}`);
    for (const artifact of artifacts)
      if (isArtifactToCount(artifact, night)) found.set(artifact.id, artifact);
    if (artifacts.length < PAGE_SIZE) return [...found.values()];
  }
}

/**
 * When each try of a run began, its first first.
 * @param {GitHub} github
 * @param {any} run
 */
async function readTryStarts(github, run) {
  const starts = [];
  for (let attempt = 1; attempt < run.run_attempt; attempt += 1) {
    const { run_started_at: startedAt } = await github(
      `/actions/runs/${run.id}/attempts/${attempt}`,
    );
    starts.push(Date.parse(startedAt));
  }
  return [...starts, Date.parse(run.run_started_at)];
}

/**
 * A run's artifacts by the try that made each: the latest try that began before it.
 * @param {any[]} artifacts
 * @param {number[]} tryStarts
 */
function groupByTry(artifacts, tryStarts) {
  /** @type {Map<number, any[]>} */
  const byTry = new Map();
  for (const artifact of artifacts) {
    const made = Date.parse(artifact.created_at);
    const index = Math.max(
      0,
      tryStarts.findLastIndex((start) => start <= made),
    );
    byTry.set(index, [...(byTry.get(index) ?? []), artifact]);
  }
  return [...byTry.values()];
}

/**
 * Each try of a CI run that made artifacts a night counts, once its run has ended, so a try's
 * reports are judged together: one still going waits for a later night.
 * @param {GitHub} github
 * @param {any[]} artifacts
 * @returns {Promise<FlakyRun[]>}
 */
async function listFlakyRuns(github, artifacts) {
  /** @type {Map<number, any[]>} */
  const byRun = new Map();
  for (const artifact of artifacts) {
    const runId = artifact.workflow_run.id;
    byRun.set(runId, [...(byRun.get(runId) ?? []), artifact]);
  }
  const flakyRuns = [];
  for (const [runId, made] of byRun) {
    const run = await github(`/actions/runs/${runId}`);
    if (run.status !== "completed") continue;
    const foundIn = { url: run.html_url, at: run.updated_at };
    for (const tried of groupByTry(made, await readTryStarts(github, run)))
      flakyRuns.push({
        id: runId,
        foundIn,
        artifacts: tried.map(({ id, name, created_at: at }) => ({ id, name, at })),
      });
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
 * The tests a try of a CI run's kept artifacts name, each found in that run: each its retry
 * passed, unless a test failed every try, and each burn-in found failing that the pull request
 * didn't write.
 * @param {string} directory the try's artifacts, each in a folder of its own
 * @param {FoundIn} foundIn the run
 * @returns {TestRuns[]}
 */
export const readRunFailures = (directory, foundIn) =>
  mergeFailedTests([
    listFailedTests(readJsonFiles(directory, "report.json"), { isRetried: true }),
    ...readJsonFiles(directory, "burn-in-flaky.json"),
  ]).map((test) => ({ ...test, foundIn }));

/**
 * A try's artifacts, each in a folder of its own, downloaded by GitHub's CLI from the repository
 * GH_REPO names. Each is fetched by its id, since a run's tries name their artifacts alike.
 * @param {FlakyRun} run
 * @returns {string} the folder that holds them
 */
function downloadRun({ id, artifacts }) {
  const directory = mkdtempSync(join(tmpdir(), `ci-run-${id}-`));
  for (const artifact of artifacts) {
    const zipPath = join(directory, `${artifact.id}.zip`);
    const zip = openSync(zipPath, "w");
    try {
      execFileSync("gh", ["api", `repos/{owner}/{repo}/actions/artifacts/${artifact.id}/zip`], {
        stdio: ["ignore", zip, "inherit"],
      });
    } finally {
      closeSync(zip);
    }
    execFileSync("unzip", ["-q", zipPath, "-d", join(directory, String(artifact.id))]);
  }
  return directory;
}

/**
 * The tests that failed in the nightly run and in each try of a CI run that made artifacts the
 * table hasn't counted, each with the latest run it failed in, and the artifacts the night counted:
 * those it read, and those the ledger counts as counted by when they were made.
 * @param {object} options
 * @param {any[]} options.nightReports the nightly run's own Playwright JSON reports
 * @param {GitHub} options.github
 * @param {{ url: string, now: Date }} options.night
 * @param {Ledger} options.ledger what the table counted before
 * @param {(run: FlakyRun) => string} [options.download]
 * @returns {Promise<{ failed: TestRuns[], counted: CountedArtifact[], skipped: FlakyRun[] }>}
 */
export async function collectFailedTests({
  nightReports,
  github,
  night,
  ledger,
  download = downloadRun,
}) {
  const uncounted = await listUncountedArtifacts(github, {
    counted: ledger.counted,
    now: night.now,
  });
  /** @param {any} artifact */
  const isCountedBefore = (artifact) => Date.parse(artifact.created_at) < ledger.countedBefore;
  const runs = await listFlakyRuns(
    github,
    uncounted.filter((artifact) => !isCountedBefore(artifact)),
  );
  const tonight = { url: night.url, at: night.now.toISOString() };
  /** @type {TestRuns[][]} */
  const failed = [listFailedTests(nightReports).map((test) => ({ ...test, foundIn: tonight }))];
  const counted = uncounted.filter(isCountedBefore).map(({ id, created_at: at }) => ({ id, at }));
  /** @type {FlakyRun[]} */
  const skipped = [];
  for (const run of runs) {
    let directory;
    try {
      directory = download(run);
    } catch (error) {
      const message = readFirstLine(error instanceof Error ? error.message : String(error));
      console.warn(
        `Could not download CI run ${run.id}'s artifacts (${run.artifacts.map(({ id }) => id).join(", ")}); leaving this try uncounted for a later night: ${message}`,
      );
      skipped.push(run);
      continue;
    }
    failed.push(readRunFailures(directory, run.foundIn));
    counted.push(...run.artifacts.map(({ id, at }) => ({ id, at })));
  }
  return {
    failed: mergeFailedTests(failed),
    counted,
    skipped,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repository = String(process.env.GITHUB_REPOSITORY);
  const runUrl = String(process.env.RUN_URL);
  const now = new Date();
  const github = createGitHub({ repository, fetchImpl: fetch, env: process.env });
  const { failed, counted, skipped } = await collectFailedTests({
    nightReports: process.argv.slice(2).map((path) => JSON.parse(readFileSync(path, "utf8"))),
    github,
    night: { url: runUrl, now },
    ledger: readLedger(await findOpenIssue(github)),
  });
  console.log(await postReport({ repository, failed, counted, runUrl, now }));
  if (skipped.length) process.exitCode = 1;
}
