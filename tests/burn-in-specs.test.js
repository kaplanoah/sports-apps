import test from "node:test";
import assert from "node:assert/strict";
import { listBrowserTestReach } from "../worker/browser-scope.mjs";
import {
  findBurnedInHead,
  isBurnedIn,
  listBrowserSpecs,
  listChangedSince,
  listSpecsToBurnIn,
} from "../worker/burn-in-specs.mjs";

const SHEETS = "apps/wnba/tests/browser/sheet-stack.spec.mjs";
const PAGE = "apps/mlb/tests/browser/page.spec.mjs";
const REACHED = listBrowserTestReach();

/**
 * @param {string[]} changedSpecs
 * @param {string[] | null} sinceBurnedIn
 */
const listSpecs = (changedSpecs, sinceBurnedIn) =>
  listSpecsToBurnIn(changedSpecs, sinceBurnedIn, REACHED);

test("the specs a change touches are an app's browser specs at any depth, as Playwright runs them", () => {
  const nested = "apps/wnba/tests/browser/sheets/drag.spec.mjs";
  assert.deepEqual(
    listBrowserSpecs([
      SHEETS,
      nested,
      "apps/wnba/tests/browser/harness.mjs",
      "apps/wnba/tests/page.test.js",
      PAGE,
    ]),
    [SHEETS, nested, PAGE],
  );
});

test("a spec that passed burn-in and hasn't changed since isn't burned in again, whatever the page and the Worker did", () => {
  assert.deepEqual(listSpecs([SHEETS, PAGE], [PAGE, "shared/page/sheet.js"]), [PAGE]);
  for (const tested of [
    "apps/wnba/page/styles.css",
    "apps/wnba/worker/src/store.js",
    "apps/mlb/worker/page-files.mjs",
    "shared/worker/season-store.js",
    "worker/plan-review.mjs",
    "README.md",
  ])
    assert.deepEqual(listSpecs([SHEETS, PAGE], [tested]), [], tested);
});

test("every changed spec burns in with no earlier burn-in, or once what every spec runs with changed", () => {
  assert.deepEqual(listSpecs([SHEETS, PAGE], null), [SHEETS, PAGE]);
  for (const shared of [
    "tests/browser/touch.mjs",
    "apps/wnba/tests/browser/harness.mjs",
    "apps/wnba/tests/player-fixtures.js",
    "worker/page-files.mjs",
    "playwright.config.mjs",
    "package.json",
    "package-lock.json",
  ])
    assert.deepEqual(listSpecs([SHEETS, PAGE], [shared]), [SHEETS, PAGE], shared);
});

test("what changed since a burn-in is the pull request's side and its base's, or nothing known for a commit the checkout lacks", () => {
  /** @type {string[][]} */
  const asked = [];
  /** @param {string[]} args */
  const readGit = (args) => {
    asked.push(args);
    if (args[0] === "merge-base") return "old-base\n";
    return args.includes("HEAD^2") ? "a.js\nb.js\n" : "b.js\ntests/browser/touch.mjs\n";
  };
  assert.deepEqual(listChangedSince("burned", readGit), [
    "a.js",
    "b.js",
    "tests/browser/touch.mjs",
  ]);
  assert.deepEqual(asked, [
    ["merge-base", "burned", "HEAD^1"],
    ["diff", "--name-only", "--no-renames", "burned", "HEAD^2"],
    ["diff", "--name-only", "--no-renames", "old-base", "HEAD^1"],
  ]);
  assert.equal(
    listChangedSince("gone", () => {
      throw new Error("bad object gone");
    }),
    null,
  );
});

test("a run burned in only once every one of its burn-in machines passed", () => {
  const job = (name, conclusion) => ({ name, conclusion });
  assert.equal(isBurnedIn([job("burn-in (1)", "success"), job("burn-in (2)", "success")]), true);
  assert.equal(isBurnedIn([job("burn-in (1)", "success"), job("burn-in (2)", "failure")]), false);
  assert.equal(isBurnedIn([job("burn-in (1)", "cancelled")]), false);
  assert.equal(isBurnedIn([job("browser (1)", "success"), job("burn-in", "skipped")]), false);
});

const REPOSITORY = { id: 1 };

/**
 * @param {number} id
 * @param {string} head_sha
 * @param {object} [overrides]
 */
const buildRun = (id, head_sha, overrides = {}) => ({
  id,
  head_sha,
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  repository: REPOSITORY,
  head_repository: REPOSITORY,
  ...overrides,
});

/**
 * @param {object[]} runs
 * @param {Record<number, { name: string, conclusion: string }[]>} jobs
 */
const answerRuns = (runs, jobs) => {
  const asked = [];
  /** @param {string} path */
  const readJson = async (path) => {
    asked.push(path);
    if (path.startsWith("/actions/workflows/")) return { workflow_runs: runs };
    const id = Number(path.match(/\/runs\/(\d+)\/jobs/)?.[1]);
    return { jobs: jobs[id] ?? [] };
  };
  return { readJson, asked };
};

test("the last burned-in head is the newest earlier head of the branch's own runs whose burn-in passed", async () => {
  const passed = [{ name: "burn-in (1)", conclusion: "success" }];
  const { readJson, asked } = answerRuns(
    [
      buildRun(5, "now"),
      buildRun(4, "fork", { head_repository: { id: 2 } }),
      buildRun(3, "label"),
      buildRun(2, "pushed"),
      buildRun(1, "older"),
    ],
    { 5: passed, 4: passed, 3: [{ name: "burn-in", conclusion: "skipped" }], 2: passed, 1: passed },
  );
  assert.equal(
    await findBurnedInHead({ readJson, branch: "claude/a b", headSha: "now" }),
    "pushed",
  );
  assert.match(asked[0], /^\/actions\/workflows\/ci\.yml\/runs\?/);
  assert.match(asked[0], /event=pull_request&status=completed/);
  assert.match(asked[0], /branch=claude%2Fa%20b&per_page=30$/);
  assert.deepEqual(asked.slice(1), [
    "/actions/runs/3/jobs?per_page=100&page=1",
    "/actions/runs/2/jobs?per_page=100&page=1",
  ]);
});

test("with no earlier run whose burn-in passed, there's no burned-in head", async () => {
  const { readJson } = answerRuns([buildRun(2, "b")], {
    2: [{ name: "burn-in (1)", conclusion: "failure" }],
  });
  assert.equal(await findBurnedInHead({ readJson, branch: "x", headSha: "c" }), null);
});

test("a run's jobs are read past their first page", async () => {
  const many = Array.from({ length: 100 }, (_, index) => ({
    name: `review-find (${index})`,
    conclusion: "success",
  }));
  const pages = {
    1: many,
    2: [{ name: "burn-in (1)", conclusion: "success" }],
  };
  /** @param {string} path */
  const readJson = async (path) =>
    path.startsWith("/actions/workflows/")
      ? { workflow_runs: [buildRun(7, "earlier")] }
      : { jobs: pages[Number(path.match(/&page=(\d+)/)?.[1])] ?? [] };
  assert.equal(await findBurnedInHead({ readJson, branch: "x", headSha: "now" }), "earlier");
});

test("a branch's burn-ins GitHub won't give burn every changed spec in, and say why", async () => {
  /** @type {string[]} */
  const logged = [];
  const readJson = async () => {
    throw new Error("GitHub answered 502 for GET /actions/workflows/ci.yml/runs");
  };
  assert.equal(
    await findBurnedInHead({
      readJson,
      branch: "x",
      headSha: "now",
      log: (message) => logged.push(message),
    }),
    null,
  );
  assert.match(logged[0], /^::warning::Couldn't read the branch's earlier burn-ins.*502/);
});
