import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decidePush } from "../.githooks/check-push.mjs";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

const HOOK = `${import.meta.dirname}/../.githooks/check-push.mjs`;
const CHECKS = ["lint", "format:check", "typecheck", "deadcode", "test"];

/**
 * A runner that records each check it's asked for, failing those in `failures` with their output.
 * @param {Record<string, string>} [failures] each failing check's output, by its npm script
 */
function fakeRunner(failures = {}) {
  /** @type {string[]} */
  const checks = [];
  /** @param {string} script */
  const runCheck = async (script) => {
    checks.push(script);
    return script in failures
      ? { isPassed: false, output: failures[script] }
      : { isPassed: true, output: "" };
  };
  return { checks, runCheck };
}

/**
 * @param {{ isTreeClean?: boolean, hasPackages?: boolean }} [state]
 * @param {Record<string, string>} [failures]
 */
async function decide(state = {}, failures = {}) {
  const { checks, runCheck } = fakeRunner(failures);
  const reason = await decidePush({ isTreeClean: true, hasPackages: true, ...state }, runCheck);
  return { reason, checks };
}

test("a push runs the four checks and every Node test, and goes when they pass", async () => {
  assert.deepEqual(await decide(), { reason: null, checks: CHECKS });
});

test("a push with uncommitted changes is refused before any check", async () => {
  const { reason, checks } = await decide({ isTreeClean: false });
  assert.match(reason ?? "", /uncommitted changes/);
  assert.deepEqual(checks, []);
});

test("a push without node_modules asks for npm ci before any check", async () => {
  const { reason, checks } = await decide({ hasPackages: false });
  assert.match(reason ?? "", /run npm ci/);
  assert.deepEqual(checks, []);
});

test("a failing check blocks the push with its output", async () => {
  const { reason } = await decide({}, { typecheck: "page.js(3,1): error TS2304" });
  assert.match(reason ?? "", /^npm run typecheck failed/);
  assert.match(reason ?? "", /page\.js\(3,1\): error TS2304/);
});

test("with more than one failing check, the first in order is shown", async () => {
  const { reason } = await decide({}, { deadcode: "unused export", lint: "no-undef" });
  assert.match(reason ?? "", /^npm run lint failed/);
  assert.doesNotMatch(reason ?? "", /unused export/);
});

test("a long failure shows its last lines and how many came before them", async () => {
  const output = Array.from({ length: 50 }, (_, index) => `error ${index + 1}`).join("\n\n");
  const { reason } = await decide({}, { lint: output });
  assert.match(reason ?? "", /\n\.\.\. 10 earlier lines\nerror 11\n/);
  assert.match(reason ?? "", /error 50$/);
  assert.doesNotMatch(reason ?? "", /error 10\n/);
});

test("a failing Node test's name and error reach a blocked push past the suite's dots", async () => {
  const dots = Array.from({ length: 300 }, () => ".".repeat(80));
  const output = [
    ...dots,
    "X",
    "Failed tests:",
    "",
    "\u2716 a game's row shows its inning (4.2ms)",
    "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    "  'Top 3' !== 'Top 4'",
    "      at TestContext.<anonymous> (file:///repo/apps/mlb/tests/page.test.js:12:10)",
  ].join("\n");
  const { reason } = await decide({}, { test: output });
  assert.match(reason ?? "", /a game's row shows its inning/);
  assert.match(reason ?? "", /'Top 3' !== 'Top 4'/);
});

/** @param {string[]} [failingScripts] */
function makeRepo(failingScripts = []) {
  const repo = mkdtempSync(join(tmpdir(), "check-push-"));
  const scripts = Object.fromEntries(
    CHECKS.map((script) => [
      script,
      failingScripts.includes(script) ? `echo ${script} broke && false` : "true",
    ]),
  );
  scripts.prepare = JSON.parse(readRepoFile("package.json")).scripts.prepare;
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts }));
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  mkdirSync(join(repo, "node_modules"));
  cpSync(new URL(".githooks", REPO_ROOT), join(repo, ".githooks"), { recursive: true });
  runGit(repo, ["init"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["commit", "-m", "start"]);
  return repo;
}

/** @param {string} folder @param {string[]} args */
function runGit(folder, args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** @param {string} folder @param {string} [command] */
function installPackages(folder, command = "install") {
  execFileSync("npm", [command, "--offline", "--no-audit", "--no-fund"], {
    cwd: folder,
    stdio: "pipe",
  });
  runGit(folder, ["add", "package-lock.json"]);
  runGit(folder, ["commit", "--allow-empty", "-m", "lock"]);
}

/** @param {string} folder @param {string[]} [refs] */
function pushRepo(folder, refs = ["HEAD:refs/heads/test"]) {
  const remote = join(folder, "node_modules/remote.git");
  execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
  return spawnSync("git", ["-C", folder, "push", remote, ...refs], {
    encoding: "utf8",
  });
}

test("npm install installs the executable Git hook and a passing push reaches its remote", (context) => {
  const repo = makeRepo();
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  const clone = join(repo, "node_modules/clone");
  runGit(repo, ["clone", repo, clone]);
  mkdirSync(join(clone, "node_modules"));
  installPackages(clone);
  assert.equal(runGit(clone, ["config", "--local", "core.hooksPath"]).trim(), ".githooks");
  assert.match(
    readFileSync(join(repo, ".githooks/pre-push"), "utf8"),
    /exec node \.githooks\/check-push\.mjs/,
  );
  const pushed = pushRepo(clone);
  assert.equal(pushed.status, 0, pushed.stderr);
  runGit(clone, ["config", "--unset", "core.hooksPath"]);
  installPackages(clone, "ci");
  assert.equal(runGit(clone, ["config", "--local", "core.hooksPath"]).trim(), ".githooks");
});

for (const script of CHECKS)
  test(`Git blocks a push when ${script} fails, with its shared check's output`, (context) => {
    const repo = makeRepo([script]);
    context.after(() => rmSync(repo, { recursive: true, force: true }));
    installPackages(repo);
    const { status, stderr } = pushRepo(repo);
    assert.notEqual(status, 0);
    assert.ok(stderr.includes(`npm run ${script} failed`), stderr);
    assert.ok(stderr.includes(`${script} broke`), stderr);
    assert.equal(
      runGit(join(repo, "node_modules/remote.git"), ["for-each-ref", "--format=%(refname)"]).trim(),
      "",
    );
  });

test("Git refuses a dirty tree and missing packages before running checks", (context) => {
  const repo = makeRepo();
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  writeFileSync(join(repo, "notes.md"), "draft");
  const rejected = pushRepo(repo);
  assert.match(rejected.stderr, /uncommitted changes/);
  assert.notEqual(rejected.status, 0);
  assert.equal(
    runGit(join(repo, "node_modules/remote.git"), ["for-each-ref", "--format=%(refname)"]).trim(),
    "",
  );
  rmSync(join(repo, "notes.md"));
  rmSync(join(repo, "node_modules"), { recursive: true });
  const head = runGit(repo, ["rev-parse", "HEAD"]).trim();
  const result = spawnSync("node", [HOOK], {
    cwd: repo,
    encoding: "utf8",
    input: `HEAD ${head} refs/heads/test ${"0".repeat(40)}\n`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node_modules is missing/);
});

test("checks run against their own repositories when Git pushes from a linked worktree", (context) => {
  const repo = makeRepo();
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  manifest.scripts.test = 'test -z "$GIT_DIR" || (echo "GIT_DIR is $GIT_DIR" && false)';
  writeFileSync(join(repo, "package.json"), JSON.stringify(manifest));
  runGit(repo, ["commit", "-am", "test reads GIT_DIR"]);
  installPackages(repo);
  const worktree = join(repo, "node_modules/worktree");
  runGit(repo, ["worktree", "add", worktree]);
  mkdirSync(join(worktree, "node_modules"));
  const pushed = pushRepo(worktree);
  assert.equal(pushed.status, 0, pushed.stderr);
});

test("Claude settings do not duplicate the Git push check", () => {
  assert.doesNotMatch(readRepoFile(".claude/settings.json"), /check-push\.mjs/);
});

/** @param {string} repo */
function publishToOrigin(repo) {
  const pushed = pushRepo(repo);
  assert.equal(pushed.status, 0, pushed.stderr);
  runGit(repo, ["remote", "add", "origin", join(repo, "node_modules/remote.git")]);
  runGit(repo, ["fetch", "origin"]);
}

test("a commit already on origin can be pushed to another branch without checking a dirty tree", (context) => {
  const repo = makeRepo();
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  publishToOrigin(repo);
  writeFileSync(join(repo, "package.json"), "invalid JSON that would fail every check");
  const pushed = pushRepo(repo, ["HEAD:refs/heads/preview"]);
  assert.equal(pushed.status, 0, pushed.stderr);
  const remoteHead = runGit(join(repo, "node_modules/remote.git"), [
    "rev-parse",
    "refs/heads/preview",
  ]).trim();
  assert.equal(remoteHead, runGit(repo, ["rev-parse", "HEAD"]).trim());
});

test("an already published other branch skips checks even when HEAD differs", (context) => {
  const repo = makeRepo();
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  publishToOrigin(repo);
  runGit(repo, ["branch", "reviewed"]);
  runGit(repo, ["commit", "--allow-empty", "-m", "unpublished"]);
  writeFileSync(join(repo, "notes.md"), "dirty");
  const pushed = pushRepo(repo, ["reviewed:refs/heads/preview"]);
  assert.equal(pushed.status, 0, pushed.stderr);
});

test("an unpublished other branch is rejected instead of checking HEAD", (context) => {
  const repo = makeRepo();
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  runGit(repo, ["checkout", "-b", "other"]);
  runGit(repo, ["commit", "--allow-empty", "-m", "other commit"]);
  runGit(repo, ["checkout", "-"]);
  const pushed = pushRepo(repo, ["other:refs/heads/other"]);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /unpublished commit other than HEAD/);
});

test("a push mixing published and unpublished commits still checks the unpublished HEAD", (context) => {
  const repo = makeRepo();
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  publishToOrigin(repo);
  runGit(repo, ["branch", "reviewed"]);
  const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  manifest.scripts.lint = "echo lint broke && exit 1";
  writeFileSync(join(repo, "package.json"), JSON.stringify(manifest));
  runGit(repo, ["add", "package.json"]);
  runGit(repo, ["commit", "-m", "failing lint"]);
  const pushed = pushRepo(repo, ["reviewed:refs/heads/preview", "HEAD:refs/heads/new"]);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /npm run lint failed/);
  const remoteRefs = runGit(join(repo, "node_modules/remote.git"), [
    "for-each-ref",
    "--format=%(refname)",
  ]);
  assert.doesNotMatch(remoteRefs, /refs\/heads\/(preview|new)/);
});

test("a commit on another remote alone does not skip checks", (context) => {
  const repo = makeRepo(["lint"]);
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  runGit(repo, ["update-ref", "refs/remotes/upstream/test", "HEAD"]);
  const pushed = pushRepo(repo);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /npm run lint failed/);
});

test("deleting a branch runs no working-tree check", (context) => {
  const repo = makeRepo();
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  publishToOrigin(repo);
  writeFileSync(join(repo, "notes.md"), "dirty");
  const pushed = pushRepo(repo, [":refs/heads/test"]);
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(
    runGit(join(repo, "node_modules/remote.git"), ["for-each-ref", "--format=%(refname)"]).trim(),
    "",
  );
});

test("annotated tags check the commit they name", (context) => {
  const repo = makeRepo(["lint"]);
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  runGit(repo, ["tag", "-a", "release", "-m", "release"]);
  const pushed = pushRepo(repo, ["refs/tags/release"]);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /npm run lint failed/);
});

test("the handoff escape can save a committed branch despite a failing check and dirty tree", (context) => {
  const repo = makeRepo(["lint"]);
  context.after(() => rmSync(repo, { recursive: true, force: true }));
  installPackages(repo);
  writeFileSync(join(repo, "notes.md"), "uncommitted scratch");
  const pushed = pushRepo(repo, ["--no-verify", "HEAD:refs/heads/handoff"]);
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(
    runGit(join(repo, "node_modules/remote.git"), ["rev-parse", "refs/heads/handoff"]).trim(),
    runGit(repo, ["rev-parse", "HEAD"]).trim(),
  );
});
