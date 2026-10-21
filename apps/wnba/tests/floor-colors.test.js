import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readDeclarations } from "../../../tests/css-rules.js";
import { LOOKS } from "../page/js/looks.js";

const PAGE = new URL("../page/", import.meta.url);
const readPageFile = (/** @type {string} */ name) => readFileSync(new URL(name, PAGE), "utf8");

/** @param {string} selector */
function readFloor(selector) {
  const floor = readDeclarations(fileURLToPath(new URL("styles.css", PAGE))).find(
    (declaration) =>
      declaration.selectors.length === 1 &&
      declaration.selectors[0] === selector &&
      declaration.property === "--bg",
  );
  return floor?.value;
}

const MAPLE_FLOOR = readFloor(":root");
const WALNUT_FLOOR = readFloor(':root[data-theme="dark"]');

/** @param {string} name */
function readMetaThemeColor(name) {
  return readPageFile(name).match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
}

test("the phone's bar takes each theme's floor", () => {
  assert.equal(LOOKS.light.barColor, MAPLE_FLOOR);
  assert.equal(LOOKS.dark.barColor, WALNUT_FLOOR);
});

test("the Home Screen app opens on Walnut's floor", () => {
  const manifest = JSON.parse(readPageFile("manifest.webmanifest"));
  assert.equal(manifest.background_color, WALNUT_FLOOR);
  assert.equal(manifest.theme_color, WALNUT_FLOOR);
});

test("the page and the gate color the phone's bar Walnut's floor before their scripts run", () => {
  assert.equal(readMetaThemeColor("index.html"), WALNUT_FLOOR);
  assert.equal(readMetaThemeColor("gate.html"), WALNUT_FLOOR);
});
