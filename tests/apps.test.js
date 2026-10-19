import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  checkAppName,
  findPageRoot,
  listApps,
  listAppsOrExit,
  listNamedApps,
} from "../worker/apps.mjs";

test("an app is a folder under apps/ whose Worker has a wrangler.toml", () => {
  assert.ok(listApps().includes("mlb"));
});

test("every app's page has a gate, so any app can be given an access code", () => {
  for (const app of listApps()) assert.ok(existsSync(`${findPageRoot(app)}gate.html`), app);
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
  [...readFileSync(`${findPageRoot(app)}${file}`, "utf8").matchAll(SHARED_LOADS[file])].map(
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

test("a command runs for the app it names, or for them all", () => {
  assert.deepEqual(listNamedApps("wnba", ["mlb", "wnba"]), ["wnba"]);
  assert.deepEqual(listNamedApps(undefined, ["mlb", "wnba"]), ["mlb", "wnba"]);
  assert.throws(() => listNamedApps("nfl", ["mlb"]), { message: /^There's no app named nfl\./ });
});

test("a command naming an app that doesn't exist says so plainly and fails", () => {
  const logged = [];
  const exits = [];
  const options = {
    apps: ["mlb", "wnba"],
    log: (message) => {
      logged.push(message);
    },
    exit: (code) => {
      exits.push(code);
    },
  };
  assert.deepEqual(listAppsOrExit("mlb", options), ["mlb"]);
  listAppsOrExit("nfl", options);
  assert.deepEqual(logged, ["There's no app named nfl. The apps are: mlb, wnba."]);
  assert.deepEqual(exits, [1]);
});
