import test from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { readRepoFile } from "./repo-files.js";

/** @param {string} path from the repo's root @param {RegExp} pattern */
const readNamed = (path, pattern) => readRepoFile(path).match(pattern)?.[1];

// The tests' harness closes the welcome as the viewer would, under the key the page's plain
// scripts keep it closed by.
test("the tests close the welcome under the key the page keeps it closed by", () => {
  const drawn = readNamed("shared/page/pick-theme.js", /const WELCOME_CLOSED_KEY = "([^"]+)";/);
  assert.ok(drawn);
  assert.equal(
    readNamed("tests/browser/harness.mjs", /localStorage\.setItem\("([^"]+)", "closed"\)/),
    drawn,
  );
});

// The plain scripts that draw the welcome before the first paint can't import a module, so they
// make device.js's tests of the device themselves.
test("the welcome tells a phone, its Home Screen, and an iPhone or iPad as device.js does", () => {
  const drawing =
    readRepoFile("shared/page/draw-home-screen-asks.js") +
    readRepoFile("shared/page/pick-theme.js");
  const device = readRepoFile("shared/page/device.js");
  for (const check of [
    '"(hover: none) and (pointer: coarse)"',
    '"(display-mode: standalone)"',
    ".standalone",
    "/iPhone|iPad|iPod/.test(navigator.userAgent)",
    'navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1',
  ]) {
    assert.ok(device.includes(check), `device.js: ${check}`);
    assert.ok(drawing.includes(check), `the plain scripts: ${check}`);
  }
});

const welcomeScript = createContext({});
runInContext(readRepoFile("shared/page/draw-home-screen-asks.js"), welcomeScript);

/** @param {string} markup */
const readWords = (markup) =>
  markup
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The text of each element with `name` as its class, in order.
 * @param {string} markup
 * @param {string} name
 */
const readTexts = (markup, name) =>
  [...markup.matchAll(new RegExp(`class="${name}"[^>]*>([\\s\\S]*?)</(?:span|h1)>`, "g"))].map(
    (match) => readWords(match[1]),
  );

// A viewer the old address sent picks the icon, adds the site, and deletes the old one.
test("the moving welcome says how to finish moving the app, in four steps", () => {
  const steps = runInContext("writeMoveSteps", welcomeScript)(true, "MLB");
  assert.deepEqual(readTexts(steps, "gate-title welcome-title"), ["Finish moving MLB"]);
  assert.deepEqual(readTexts(steps, "welcome-step"), [
    "Pick your icon",
    "Tap Share",
    "Tap Add to Home Screen",
    "Delete the old MLB Site",
  ]);
  assert.deepEqual(readTexts(steps, "welcome-note"), [
    "You can change your theme later in Settings",
    "Press and hold, then tap Delete Bookmark",
  ]);
  assert.match(steps, /Tap <svg\s+class="share-glyph"/);
  assert.equal(steps.match(/<li>/g)?.length, 4);
  assert.doesNotMatch(steps, /data-ask|data-install/);
});

test("the moving welcome names each app", () => {
  const steps = runInContext("writeMoveSteps", welcomeScript)(true, "WNBA");
  assert.deepEqual(readTexts(steps, "gate-title welcome-title"), ["Finish moving WNBA"]);
  assert.ok(readTexts(steps, "welcome-step").includes("Delete the old WNBA Site"));
});

test("the welcome that adds the app keeps its own steps", () => {
  const steps = runInContext("writeAddSteps", welcomeScript)(true, "MLB");
  assert.deepEqual(readTexts(steps, "gate-title welcome-title"), ["Add MLB to your home screen"]);
  assert.equal(readTexts(steps, "welcome-step")[0], "Pick your theme");
  assert.match(steps, /data-ask="install"/);
});
