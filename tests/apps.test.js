import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkAppName,
  checkWorkerName,
  findWorkerFolder,
  findWorkerRoot,
  isService,
  listApps,
  listAppsWithBrowserTests,
  listNamedWorkers,
  listWorkers,
  listWorkersOrExit,
} from "../worker/apps.mjs";
import { createServiceRoots } from "./service-roots.js";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

/** @param {string} app */
const findPageFolder = (app) => `apps/${app}/page/`;

test("an app is a folder under apps/ whose Worker has a wrangler.toml", () => {
  assert.ok(listApps().includes("mlb"));
});

// Playwright makes a project for each, and CI's browser jobs name the ones a change reaches.
test("the apps with browser tests are the apps with a tests/browser folder", () => {
  const root = mkdtempSync(join(tmpdir(), "apps-"));
  try {
    for (const [app, folders] of /** @type {[string, string[]][]} */ ([
      ["nba", ["worker", "tests/browser"]],
      ["nhl", ["worker"]],
      ["notes", ["tests/browser"]],
    ])) {
      for (const folder of folders) mkdirSync(join(root, app, folder), { recursive: true });
      if (folders.includes("worker")) writeFileSync(join(root, app, "worker/wrangler.toml"), "");
    }
    const appsRoot = pathToFileURL(`${root}/`);
    assert.deepEqual(listApps(appsRoot), ["nba", "nhl"]);
    assert.deepEqual(listAppsWithBrowserTests(appsRoot), ["nba"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.match(
    readRepoFile("playwright.config.mjs"),
    /const appsWithBrowserTests = listAppsWithBrowserTests\(\);/,
  );
});

test("every app's page has a gate, so any app can be given an access code", () => {
  for (const app of listApps())
    assert.ok(existsSync(new URL(`${findPageFolder(app)}gate.html`, REPO_ROOT)), app);
});

const SHARED_LOADS = {
  "index.html":
    /(?:href|src)="(shared\/[^"]+|styles\.css)"|\b(openLastTab|showLastDrawn|followSeasonPart|watchSlowLoad)\(\);/g,
  "gate.html": /(?:href|src)="(shared\/[^"]+|styles\.css)"/g,
  "sw.js": /"(shared\/[^"]+)"/g,
};

/**
 * @param {string} app
 * @param {string} file
 */
const listSharedLoads = (app, file) =>
  [...readRepoFile(`${findPageFolder(app)}${file}`).matchAll(SHARED_LOADS[file])].map(
    ([, path, call]) => path ?? call,
  );

test("every app's page, gate, and service worker load the same shared files, in the same order", () => {
  const [firstApp, ...otherApps] = listApps();
  for (const file of Object.keys(SHARED_LOADS)) {
    const firstLoads = listSharedLoads(firstApp, file);
    assert.ok(firstLoads.length > 0, file);
    for (const app of otherApps)
      assert.deepEqual(listSharedLoads(app, file), firstLoads, `${app} ${file}`);
  }
});

test("a command takes only an app that exists, and says which ones do", () => {
  assert.equal(checkAppName("mlb", ["mlb", "wnba"]), "mlb");
  assert.throws(() => checkAppName("nfl", ["mlb", "wnba"]), {
    message: "There's no app named nfl. The apps are: mlb, wnba.",
  });
  assert.throws(() => checkAppName(undefined, ["mlb"]), {
    message: "Name an app. The apps are: mlb.",
  });
});

test("a command runs for the Worker it names, or for them all", () => {
  assert.deepEqual(listNamedWorkers("wnba", ["mlb", "wnba"]), ["wnba"]);
  assert.deepEqual(listNamedWorkers(undefined, ["mlb", "wnba"]), ["mlb", "wnba"]);
  assert.throws(() => listNamedWorkers("nfl", ["mlb"]), {
    message: /^There's no Worker named nfl\./,
  });
});

test("a command naming a Worker that doesn't exist says so plainly and fails", () => {
  const logged = [];
  const exits = [];
  const options = {
    workers: ["mlb", "wnba"],
    log: (message) => {
      logged.push(message);
    },
    exit: (code) => {
      exits.push(code);
    },
  };
  assert.deepEqual(listWorkersOrExit("mlb", options), ["mlb"]);
  listWorkersOrExit("nfl", options);
  assert.deepEqual(logged, ["There's no Worker named nfl. The Workers are: mlb, wnba."]);
  assert.deepEqual(exits, [1]);
});

test("a service is a folder under services/ whose Worker has a wrangler.toml, and comes before the apps", () => {
  const { roots, remove } = createServiceRoots();
  try {
    const { servicesRoot } = roots;
    assert.deepEqual(listWorkers(roots), ["accounts", ...listApps()]);
    assert.equal(isService("accounts", servicesRoot), true);
    assert.equal(isService("mlb", servicesRoot), false);
    assert.equal(findWorkerFolder("accounts", servicesRoot), "services/accounts/");
    assert.equal(findWorkerFolder("mlb", servicesRoot), "apps/mlb/");
    assert.equal(findWorkerRoot("accounts", roots).href, new URL("accounts/", servicesRoot).href);
    assert.throws(() => checkWorkerName("nfl", listWorkers(roots)), {
      message: `There's no Worker named nfl. The Workers are: ${["accounts", ...listApps()].join(", ")}.`,
    });
    assert.throws(() => checkAppName("accounts"), { message: /^There's no app named accounts\./ });
  } finally {
    remove();
  }
});
