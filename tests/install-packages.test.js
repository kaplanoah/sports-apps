import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInstallNeeded } from "../.claude/hooks/install-packages.mjs";
import { readRepoFile } from "./repo-files.js";

const HOOK = `${import.meta.dirname}/../.claude/hooks/install-packages.mjs`;
const LOCKFILE_TIME = new Date("2026-10-01T12:00:00Z");

/**
 * A folder with a lockfile changed at `LOCKFILE_TIME`, and, unless `installedAt` is undefined, a
 * node_modules whose install record was written then; `hasRecord` false leaves the record out.
 * @param {{ installedAt?: Date, hasRecord?: boolean }} [options]
 */
function makeFolder({ installedAt, hasRecord = true } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "install-packages-"));
  execFileSync("git", ["init", folder], { stdio: "ignore" });
  const lockfile = join(folder, "package-lock.json");
  writeFileSync(lockfile, "{}");
  utimesSync(lockfile, LOCKFILE_TIME, LOCKFILE_TIME);
  if (installedAt) {
    mkdirSync(join(folder, "node_modules"));
    if (hasRecord) {
      const record = join(folder, "node_modules", ".package-lock.json");
      writeFileSync(record, "{}");
      utimesSync(record, installedAt, installedAt);
    }
  }
  return folder;
}

test("a folder with no node_modules needs an install", () => {
  assert.equal(isInstallNeeded(makeFolder()), true);
});

test("a node_modules without npm's install record needs an install", () => {
  assert.equal(isInstallNeeded(makeFolder({ installedAt: LOCKFILE_TIME, hasRecord: false })), true);
});

test("an install older than the lockfile needs another", () => {
  const installedAt = new Date(LOCKFILE_TIME.getTime() - 60_000);
  assert.equal(isInstallNeeded(makeFolder({ installedAt })), true);
});

test("an install newer than the lockfile needs none", () => {
  const installedAt = new Date(LOCKFILE_TIME.getTime() + 60_000);
  assert.equal(isInstallNeeded(makeFolder({ installedAt })), false);
});

test("a folder with no lockfile needs no install", () => {
  assert.equal(isInstallNeeded(mkdtempSync(join(tmpdir(), "install-packages-"))), false);
});

/**
 * Runs the hook for a project folder, with a fake `npm` first on its PATH that writes the
 * arguments it was given to `npm-arguments.txt` in the folder it ran in and exits with `exitCode`.
 * @param {string} folder
 * @param {number} [exitCode]
 */
function runHook(folder, exitCode = 0) {
  const bin = mkdtempSync(join(tmpdir(), "install-packages-bin-"));
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$@" > npm-arguments.txt\nexit ${exitCode}\n`, {
    mode: 0o755,
  });
  return spawnSync("node", [HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: folder, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf8",
  });
}

test("session start installs the Git hook even when packages are current, without running npm", () => {
  const installedAt = new Date(LOCKFILE_TIME.getTime() + 60_000);
  const folder = makeFolder({ installedAt });
  const { status, stdout } = runHook(folder);
  assert.deepEqual({ status, stdout }, { status: 0, stdout: "" });
  assert.throws(() => readFileSync(join(folder, "npm-arguments.txt")), { code: "ENOENT" });
  const readHookPath = () =>
    execFileSync("git", ["config", "--local", "core.hooksPath"], {
      cwd: folder,
      encoding: "utf8",
    }).trim();
  assert.equal(readHookPath(), ".githooks");
  execFileSync("git", ["config", "--local", "core.hooksPath", "other-hooks"], { cwd: folder });
  assert.equal(runHook(folder).status, 0);
  assert.equal(readHookPath(), ".githooks");
});

test("the hook runs npm ci in the project's folder and says so in one line", () => {
  const folder = makeFolder();
  const { status, stdout } = runHook(folder);
  assert.deepEqual(
    { status, stdout },
    {
      status: 0,
      stdout: "Installed packages with npm ci, since node_modules was out of date.\n",
    },
  );
  assert.equal(readFileSync(join(folder, "npm-arguments.txt"), "utf8"), "ci\n");
});

test("the hook lets the session start, and says so, when npm ci fails", () => {
  const folder = makeFolder();
  const { status, stdout } = runHook(folder, 1);
  assert.equal(
    execFileSync("git", ["config", "--local", "core.hooksPath"], {
      cwd: folder,
      encoding: "utf8",
    }).trim(),
    ".githooks",
  );
  assert.deepEqual(
    { status, stdout },
    { status: 0, stdout: "npm ci failed; run it before AGENTS.md's checks.\n" },
  );
});

test("the project's settings run the hook as every session starts", () => {
  const { hooks } = JSON.parse(readRepoFile(".claude/settings.json"));
  const entry = hooks.SessionStart?.find(({ hooks: commands }) =>
    commands.some(({ command }) => command.endsWith('/.claude/hooks/install-packages.mjs"')),
  );
  assert.ok(entry);
  assert.equal(entry.matcher, undefined);
});
