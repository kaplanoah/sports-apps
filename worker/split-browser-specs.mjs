// Splits the browser specs among CI's machines by how long each takes, so the machines finish
// together. Playwright's own --shard splits by count, and a few slow specs leave one machine
// running long after the rest. Each machine runs its own share with --test-list.
// Usage: node worker/split-browser-specs.mjs <machine> <machines>, which prints that machine's
// specs, or node worker/split-browser-specs.mjs --record <report.json>..., which saves each spec's
// time from Playwright JSON reports of a Chromium run.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findAppRoot, listApps } from "./apps.mjs";

const TIMES_FILE = new URL("../tests/browser/spec-times.json", import.meta.url);

/** @returns {string[]} each app's browser specs, from the repo's root */
export const listBrowserSpecs = (apps = listApps()) =>
  apps.flatMap((app) => {
    const folder = new URL("tests/browser/", findAppRoot(app));
    return readdirSync(folder)
      .filter((name) => name.endsWith(".spec.mjs"))
      .map((name) => `apps/${app}/tests/browser/${name}`);
  });

/** @param {number[]} values */
const findMedian = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * The first of the shares with the least time.
 * @template {{ seconds: number }} Share
 * @param {Share[]} shares
 */
const findLightest = (shares) =>
  shares.reduce((least, share) => (share.seconds < least.seconds ? share : least));

/**
 * Gives each spec, longest first, to the machine with the least time so far, so every machine
 * reaches the same split from the same specs and times. A spec with no time yet counts as the
 * median spec.
 * @param {string[]} specs
 * @param {Record<string, number>} times seconds, by spec
 * @param {number} machines
 * @returns {string[][]} each machine's specs
 */
export function splitSpecs(specs, times, machines) {
  const known = specs.filter((spec) => spec in times).map((spec) => times[spec]);
  const fallback = known.length ? findMedian(known) : 1;
  const readTime = (/** @type {string} */ spec) => times[spec] ?? fallback;
  const longestFirst = specs.toSorted((a, b) => readTime(b) - readTime(a) || a.localeCompare(b));
  const shares = Array.from({ length: machines }, () => ({
    seconds: 0,
    specs: /** @type {string[]} */ ([]),
  }));
  for (const spec of longestFirst) {
    const lightest = findLightest(shares);
    lightest.seconds += readTime(spec);
    lightest.specs.push(spec);
  }
  return shares.map((share) => share.specs.toSorted());
}

/** @param {any} test a test in a Playwright JSON report, with its runs */
const readAverageSeconds = (test) => {
  /** @type {number[]} */
  const durations = test.results.map((/** @type {any} */ result) => result.duration);
  return durations.reduce((sum, ms) => sum + ms, 0) / durations.length / 1000;
};

/**
 * Each spec's seconds in the reports, each test's runs averaged, from each app's Chromium project,
 * which is named for its app.
 * @param {any[]} reports Playwright JSON reports
 * @param {string[]} apps
 * @returns {Record<string, number>}
 */
export function measureSpecTimes(reports, apps = listApps()) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  const isTimed = (/** @type {any} */ test) =>
    apps.includes(test.projectName) && test.results.length > 0;
  /** @param {any} suite */
  const addSuite = (suite) => {
    for (const child of suite.suites ?? []) addSuite(child);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests.filter(isTimed)) {
        totals.set(spec.file, (totals.get(spec.file) ?? 0) + readAverageSeconds(test));
      }
    }
  };
  for (const report of reports) for (const suite of report.suites ?? []) addSuite(suite);
  return Object.fromEntries(
    [...totals]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([spec, seconds]) => [spec, Math.round(seconds * 10) / 10]),
  );
}

/** @returns {Record<string, number>} */
export const readSpecTimes = () => JSON.parse(readFileSync(TIMES_FILE, "utf8"));

/** @param {string[]} reportPaths */
const recordSpecTimes = (reportPaths) => {
  const reports = reportPaths.map((path) => JSON.parse(readFileSync(path, "utf8")));
  writeFileSync(TIMES_FILE, `${JSON.stringify(measureSpecTimes(reports), null, 2)}\n`);
};

/** @param {number} machine @param {number} machines */
const isMachineOf = (machine, machines) =>
  Number.isInteger(machine) && Number.isInteger(machines) && machine >= 1 && machine <= machines;

/** @param {number} machine @param {number} machines */
const printShare = (machine, machines) => {
  if (!isMachineOf(machine, machines)) {
    console.error("Usage: node worker/split-browser-specs.mjs <machine> <machines>");
    process.exit(1);
  }
  const shares = splitSpecs(listBrowserSpecs(), readSpecTimes(), machines);
  console.log(shares[machine - 1].join("\n"));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [first, ...rest] = process.argv.slice(2);
  if (first === "--record") recordSpecTimes(rest);
  else printShare(Number(first), Number(rest[0]));
}
