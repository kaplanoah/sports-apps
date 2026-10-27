import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decidePush } from "../.claude/hooks/check-push.mjs";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

const HOOK = `${import.meta.dirname}/../.claude/hooks/check-push.mjs`;
const CHECKS = ["lint", "format:check", "typecheck", "deadcode"];

/**
 * A runner that records each npm script it's asked for, failing those in `failures` with their output.
 * @param {Record<string, string>} [failures]
 */
function fakeRunner(failures = {}) {
  /** @type {string[]} */
  const scripts = [];
  /** @param {string} script */
  const runCheck = async (script) => {
    scripts.push(script);
    return script in failures
      ? { isPassed: false, output: failures[script] }
      : { isPassed: true, output: "" };
  };
  return { scripts, runCheck };
}

/**
 * @param {{ isTreeClean?: boolean, hasPackages?: boolean }} [state]
 * @param {Record<string, string>} [failures]
 */
async function decide(state = {}, failures = {}) {
  const { scripts, runCheck } = fakeRunner(failures);
  const reason = await decidePush({ isTreeClean: true, hasPackages: true, ...state }, runCheck);
  return { reason, scripts };
}

test("a push runs the four checks and goes when they pass", async () => {
  assert.deepEqual(await decide(), { reason: null, scripts: CHECKS });
});

test("a push with uncommitted changes is refused before any check", async () => {
  const { reason, scripts } = await decide({ isTreeClean: false });
  assert.match(reason ?? "", /uncommitted changes/);
  assert.deepEqual(scripts, []);
});

test("a push without node_modules asks for npm ci before any check", async () => {
  const { reason, scripts } = await decide({ hasPackages: false });
  assert.match(reason ?? "", /run npm ci/);
  assert.deepEqual(scripts, []);
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

test("a long failure shows its first lines and how many more there are", async () => {
  const output = Array.from({ length: 50 }, (_, index) => `error ${index + 1}`).join("\n\n");
  const { reason } = await decide({}, { lint: output });
  assert.match(reason ?? "", /error 40\n\.\.\. and 10 more lines$/);
  assert.doesNotMatch(reason ?? "", /error 41/);
});

/** @param {string[]} [failingScripts] */
function makeRepo(failingScripts = []) {
  const repo = mkdtempSync(join(tmpdir(), "check-push-"));
  const scripts = Object.fromEntries(
    CHECKS.map((script) => [
      script,
      failingScripts.includes(script) ? `echo ${script} broke && exit 1` : "true",
    ]),
  );
  scripts.prepare = JSON.parse(readRepoFile("package.json")).scripts.prepare;
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts }));
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  mkdirSync(join(repo, "node_modules"));
  cpSync(new URL(".githooks", REPO_ROOT), join(repo, ".githooks"), { recursive: true });
  mkdirSync(join(repo, ".claude/hooks"), { recursive: true });
  cpSync(HOOK, join(repo, ".claude/hooks/check-push.mjs"));
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

/** @param {string} folder */
function pushRepo(folder) {
  const remote = join(folder, "node_modules/remote.git");
  execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
  return spawnSync("git", ["-C", folder, "push", remote, "HEAD:refs/heads/test"], {
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
    /exec node \.claude\/hooks\/check-push\.mjs/,
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
  assert.match(pushRepo(repo).stderr, /uncommitted changes/);
  rmSync(join(repo, "notes.md"));
  rmSync(join(repo, "node_modules"), { recursive: true });
  const result = spawnSync("node", [HOOK], { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node_modules is missing/);
});

test("Claude settings do not duplicate the Git push check", () => {
  assert.doesNotMatch(readRepoFile(".claude/settings.json"), /check-push\.mjs/);
});
