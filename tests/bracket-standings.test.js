import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSeasonParts } from "#shared/bracket-standings.js";

test("until the playoff field is set the tab opens on the standings, and from then on the bracket, with the one it opens on first", () => {
  assert.deepEqual(orderSeasonParts(false), ["standings", "bracket"]);
  assert.deepEqual(orderSeasonParts(true), ["bracket", "standings"]);
});
