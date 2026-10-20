import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
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

test("the hook says nothing and lets the session start when the install is current", () => {
  const installedAt = new Date(LOCKFILE_TIME.getTime() + 60_000);
  const { status, stdout } = spawnSync("node", [HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: makeFolder({ installedAt }) },
    encoding: "utf8",
  });
  assert.deepEqual({ status, stdout }, { status: 0, stdout: "" });
});

test("the project's settings run the hook as every session starts", () => {
  const { hooks } = JSON.parse(readRepoFile(".claude/settings.json"));
  const entry = hooks.SessionStart?.find(({ hooks: commands }) =>
    commands.some(({ command }) => command.endsWith('/.claude/hooks/install-packages.mjs"')),
  );
  assert.ok(entry);
  assert.equal(entry.matcher, undefined);
});
