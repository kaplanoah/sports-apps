import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRequiredBrowsers, WEBKIT_TEST_MATCH } from "./browser/projects.mjs";
import { readRepoFile } from "./repo-files.js";

test("explicit Chromium and WebKit projects install their own engine", () => {
  for (const app of ["mlb", "wnba"]) {
    assert.deepEqual(listRequiredBrowsers({ project: app }), ["chromium"]);
    assert.deepEqual(listRequiredBrowsers({ project: `${app}-webkit` }), ["webkit"]);
    assert.deepEqual(listRequiredBrowsers({ project: app, tests: "at-rest" }), ["chromium"]);
  }
});

test("literal Chromium-only specs and optional line suffixes avoid WebKit dependencies", () => {
  for (const suffix of ["", ":123", ":123:4"]) {
    const tests = ["mlb", "wnba"]
      .map((app) => `apps/${app}/tests/browser/settings.spec.mjs${suffix}`)
      .join(" ");
    assert.deepEqual(listRequiredBrowsers({ tests: `  ${tests}  ` }), ["chromium"]);
  }
});

test("font and notification alignment specs selected alone install Chromium and WebKit", () => {
  for (const app of ["mlb", "wnba"])
    for (const spec of ["team-lines", "team-line-tuning", "notification-layout"])
      assert.deepEqual(
        listRequiredBrowsers({ tests: `apps/${app}/tests/browser/${spec}.spec.mjs` }),
        ["chromium", "webkit"],
      );
});

test("nightly, all-test, WebKit and ambiguous selections keep both engines", () => {
  for (const selection of [
    {},
    { tests: " " },
    ...WEBKIT_TEST_MATCH.map((spec) => ({ tests: `apps/mlb/tests/browser/${spec}:12` })),
    {
      tests:
        "apps/mlb/tests/browser/notifications.spec.mjs apps/wnba/tests/browser/at-rest.spec.mjs",
    },
    { tests: "notifications" },
    { tests: "apps/mlb/tests/browser/.*.spec.mjs" },
    { tests: "apps/mlb/tests/browser/missing.spec.mjs" },
    { tests: "apps/mlb/tests/browser/notifications.spec.mjs:line" },
    { project: "mlb*" },
    { project: "missing", tests: "apps/mlb/tests/browser/notifications.spec.mjs" },
  ])
    assert.deepEqual(
      listRequiredBrowsers(selection),
      ["chromium", "webkit"],
      JSON.stringify(selection),
    );
});

test("Playwright and browser installation share WebKit's test match", () => {
  assert.match(readRepoFile("playwright.config.mjs"), /testMatch: WEBKIT_TEST_MATCH/);
  assert.match(readRepoFile("playwright.config.mjs"), /name: nameWebKitProject\(app\)/);
  assert.deepEqual(WEBKIT_TEST_MATCH, [
    "at-rest.spec.mjs",
    "team-lines.spec.mjs",
    "team-line-tuning.spec.mjs",
    "notification-layout.spec.mjs",
    "notification-permission.spec.mjs",
    "settings-contact.spec.mjs",
    "word-centering.spec.mjs",
  ]);
});

test("the selection command publishes only browser names as workflow arguments", () => {
  const folder = mkdtempSync(join(tmpdir(), "browser-projects-"));
  const output = join(folder, "outputs");
  try {
    for (const { selection, browsers } of [
      { selection: { PROJECT: "mlb" }, browsers: "chromium" },
      { selection: { PROJECT: "wnba-webkit" }, browsers: "webkit" },
      {
        selection: { TESTS: "apps/mlb/tests/browser/notifications.spec.mjs:14" },
        browsers: "chromium",
      },
      {
        selection: { TESTS: "notifications; echo untrusted", PROJECT: "*" },
        browsers: "chromium webkit",
      },
      { selection: {}, browsers: "chromium webkit" },
    ]) {
      const result = spawnSync(process.execPath, ["tests/browser/projects.mjs"], {
        env: { ...process.env, TESTS: "", PROJECT: "", ...selection, GITHUB_OUTPUT: output },
        encoding: "utf8",
        timeout: 2000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, "utf8").trim().split("\n").at(-1), `browsers=${browsers}`);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
