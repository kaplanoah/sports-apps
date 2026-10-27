import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  listBrowserTestReach,
  listReachedFiles,
  listTestedApps,
  resolveImport,
  readRepoText,
} from "../worker/browser-scope.mjs";

const APPS = ["mlb", "wnba"];
const REACHED = new Set(["worker/check-page.mjs", "tests/durable-object-context.js"]);

/** @param {string[]} paths */
const listApps = (paths) => listTestedApps(paths, { apps: APPS, reached: REACHED });

test("the shared repo reader uses the requested root and leaves missing files out of reach", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "repo-reader-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, "fixture.js"), "export const value = 1;");
  const root = pathToFileURL(`${folder}/`);
  assert.equal(readRepoText("fixture.js", root), "export const value = 1;");
  assert.equal(readRepoText("missing.js", root), null);
  assert.match(readRepoText("worker/browser-scope.mjs"), /export const readRepoText/);
});

test("a change to the docs, the other workflows, or the tooling no browser test imports runs none", () => {
  assert.deepEqual(
    listApps([
      "README.md",
      "apps/mlb/README.md",
      ".githooks/pre-push",
      ".githooks/check-push.mjs",
      ".agents/skills/steward/SKILL.md",
      ".github/workflows/flaky.yml",
      "worker/plan-review.mjs",
      "tests/plan-review.test.js",
      "tests/time-zone-sensitive.json",
      "apps/wnba/tests/search.test.js",
      "services/accounts/tests/health.test.js",
      "knip.json",
      "stryker.config.mjs",
      "types/globals.d.ts",
    ]),
    [],
  );
});

test("a change in one app's folder runs that app's browser tests", () => {
  assert.deepEqual(
    listApps(["apps/wnba/page/styles.css", "apps/wnba/tests/browser/page.spec.mjs"]),
    ["wnba"],
  );
  assert.deepEqual(listApps(["apps/mlb/tests/fixtures/2026-10-13-player-index.json"]), ["mlb"]);
  assert.deepEqual(listApps(["apps/nhl/page/styles.css"]), [], "an app with no browser tests yet");
});

test("only the root's session folder skips every app's browser tests", () => {
  for (const path of [
    ".claude/settings.json",
    ".claude/hooks/an-unlisted-hook.mjs",
    ".claude/another-folder/nested/file.js",
  ])
    assert.deepEqual(listApps([path]), [], path);
  assert.deepEqual(listApps(["shared/.claude/hooks/an-unlisted-hook.mjs"]), APPS);
});

test("shared code, a service, browser setup, the dependencies, and an unknown file run every app's", () => {
  for (const path of [
    "shared/page/sheet.js",
    "services/accounts/worker/src/index.js",
    ".github/workflows/ci.yml",
    "worker/install-browsers.mjs",
    "package-lock.json",
    "playwright.config.mjs",
    "tests/fixtures/new.json",
    "a-new-folder/file.txt",
  ])
    assert.deepEqual(listApps([path]), APPS, path);
});

test("tooling or a test helper a browser test imports runs every app's", () => {
  assert.deepEqual(listApps(["worker/check-page.mjs"]), APPS);
  assert.deepEqual(listApps(["tests/durable-object-context.js"]), APPS);
});

test("imports resolve from the importer, through the import map's names, and leave packages out", () => {
  assert.equal(
    resolveImport("../../../../tests/browser/touch.mjs", "apps/wnba/tests/browser/page.spec.mjs"),
    "tests/browser/touch.mjs",
  );
  assert.equal(
    resolveImport("#shared/html.js", "apps/mlb/tests/browser/x.spec.mjs"),
    "shared/page/html.js",
  );
  assert.equal(
    resolveImport("#page-files/mlb", "apps/mlb/tests/browser/harness.mjs"),
    "apps/mlb/worker/page-files.mjs",
  );
  assert.equal(resolveImport("@playwright/test", "tests/browser/harness.mjs"), null);
  assert.equal(resolveImport("#unmapped/x.js", "tests/browser/harness.mjs"), null);
});

test("package imports keep literal dollar sequences in filenames as Node does", () => {
  for (const prefix of ["#shared/", "#page-files/"])
    for (const name of ["$&", "$$", "$'", "$`"]) {
      const specifier = `${prefix}${name}.js`;
      const resolved = resolveImport(specifier, "apps/mlb/tests/browser/a.spec.mjs");
      assert.ok(resolved);
      assert.equal(
        new URL(resolved, new URL("../", import.meta.url)).href,
        import.meta.resolve(specifier),
      );
    }
});

test("every wildcard in a package import target resolves as Node does", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "package-imports-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, "worker"));
  copyFileSync(
    new URL("../worker/package-imports.mjs", import.meta.url),
    join(folder, "worker/package-imports.mjs"),
  );
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({ imports: { "#fixture/*": "./shared/*/copy/*.js" } }),
  );
  writeFileSync(
    join(folder, "resolve.mjs"),
    "export const resolveWithNode = (specifier) => import.meta.resolve(specifier);",
  );
  const { resolvePackageImport } = await import(
    pathToFileURL(join(folder, "worker/package-imports.mjs")).href
  );
  const { resolveWithNode } = await import(pathToFileURL(join(folder, "resolve.mjs")).href);
  for (const name of ["file", "$&", "$$", "$'", "$`"]) {
    const specifier = `#fixture/${name}`;
    const resolved = resolvePackageImport(specifier);
    assert.ok(resolved);
    assert.equal(new URL(resolved, pathToFileURL(`${folder}/`)).href, resolveWithNode(specifier));
  }
});

test("browser scope includes tooling reached through import filenames with literal dollar sequences", () => {
  for (const name of ["$&", "$$", "$`"]) {
    const entry = "apps/mlb/tests/browser/a.spec.mjs";
    const shared = `shared/page/${name}.js`;
    const tooling = "worker/needed.mjs";
    const files = {
      [entry]: `import ${JSON.stringify(`#shared/${name}.js`)};`,
      [shared]: 'import "../../worker/needed.mjs";',
      [tooling]: "",
    };
    const reached = listReachedFiles([entry], (path) => files[path] ?? null);
    assert.deepEqual([...reached].toSorted(), [entry, shared, tooling]);
    assert.deepEqual(listTestedApps([tooling], { apps: APPS, reached }), APPS);
  }
});

test("the reached files follow every import from the entries, static and dynamic", () => {
  const files = {
    "apps/mlb/tests/browser/a.spec.mjs":
      'import { b } from "./harness.mjs";\nawait import("#shared/c.js");\nimport "../../../../worker/side.mjs";',
    "apps/mlb/tests/browser/harness.mjs": 'export { d } from "../../worker/page-files.mjs";',
    "apps/mlb/worker/page-files.mjs":
      'import { readPageFiles } from "../../../worker/page-files.mjs";',
    "worker/page-files.mjs": 'import { readFileSync } from "node:fs";',
    "worker/side.mjs": "",
    "shared/page/c.js": "",
    "worker/unreached.mjs": "",
  };
  const reached = listReachedFiles(["apps/mlb/tests/browser/a.spec.mjs", "missing.mjs"], (path) =>
    path in files ? files[path] : null,
  );
  assert.deepEqual([...reached].toSorted(), [
    "apps/mlb/tests/browser/a.spec.mjs",
    "apps/mlb/tests/browser/harness.mjs",
    "apps/mlb/worker/page-files.mjs",
    "shared/page/c.js",
    "worker/page-files.mjs",
    "worker/side.mjs",
  ]);
});

test("the repo's browser tests reach the tooling and helpers they import, through every helper", () => {
  const reached = listBrowserTestReach();
  for (const path of [
    "playwright.config.mjs",
    "worker/apps.mjs",
    "worker/build.mjs",
    "worker/check-page.mjs",
    "tests/browser/harness.mjs",
    "apps/wnba/tests/player-fixtures.js",
  ])
    assert.ok(reached.has(path), path);
  assert.ok(!reached.has("worker/plan-review.mjs"));
});

test("executable agent files and unlisted Git hooks retain browser coverage", () => {
  for (const path of [
    ".agents/skills/scripts/check.mjs",
    ".agents/shared.js",
    ".githooks/future.mjs",
  ])
    assert.deepEqual(listApps([path]), APPS, path);
});
