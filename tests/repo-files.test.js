import { test } from "node:test";
import assert from "node:assert/strict";
import { isKeptBinary } from "./repo-files.js";

// The repo scans read every file but these, so a skip that widens lets a secret in a binary through.
test("the repo scans skip only the PNG images and fonts, never another kind of file", () => {
  assert.ok(isKeptBinary("apps/mlb/page/icon-180.png"));
  assert.ok(isKeptBinary("shared/page/fonts/barlow.woff2"));
  for (const path of ["icon.ico", "photo.jpg", "state.sqlite", "app.wasm", "icon.svg", "a.js"])
    assert.ok(!isKeptBinary(path), path);
});
