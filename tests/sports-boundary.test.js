import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { listReachedFiles, readRepoText } from "../worker/browser-scope.mjs";

const VENDOR_DATA_URL =
  /https?:\/\/(?:(?:cdn|stats)\.wnba\.com|statsapi\.mlb\.com|site(?:\.web)?\.api\.espn\.com|api\.balldontlie\.io)\//;
const VALIDATOR_IMPORT = /["']zod(?:\/[^"']*)?["']/;

/** @param {string[]} entries @param {(path: string) => string | null} readText */
function findBoundaryProblems(entries, readText) {
  return [...listReachedFiles(entries, readText)].filter((path) => {
    const text = readText(path);
    return (
      path.includes("/adapters/") ||
      /\/(?:espn-adapter|sports-schema)\.js$/.test(path) ||
      VENDOR_DATA_URL.test(text) ||
      VALIDATOR_IMPORT.test(text)
    );
  });
}

test("no page can reach a vendor data URL, Worker adapter, or Zod", () => {
  const entries = ["shared/page", "apps/wnba/page", "apps/mlb/page"].flatMap((folder) =>
    readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".js"))
      .map((name) => `${folder}/${name}`),
  );
  assert.deepEqual(findBoundaryProblems(entries, readRepoText), []);
});

test("the page boundary catches indirect imports and vendor reads as well as Zod", () => {
  const files = {
    "apps/example/page/app.js": 'import "./rules.js";',
    "apps/example/page/rules.js": 'export * from "../../../shared/page/rules.js";',
    "shared/page/rules.js": 'import "../worker/espn-adapter.js";',
    "shared/worker/espn-adapter.js": 'import { z } from "zod";',
  };
  assert.deepEqual(
    findBoundaryProblems(["apps/example/page/app.js"], (path) => files[path] ?? null),
    ["shared/worker/espn-adapter.js"],
  );
  for (const text of [
    'const path = "https://statsapi.mlb.com/api/v1/schedule";',
    'import { z } from "zod/v4";',
  ]) {
    assert.deepEqual(
      findBoundaryProblems(["page.js"], () => text),
      ["page.js"],
    );
  }
});
