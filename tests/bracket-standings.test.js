import { test } from "node:test";
import assert from "node:assert/strict";
import { findTopToShow, orderSeasonParts } from "#shared/bracket-standings.js";

test("until the playoff field is set the tab opens on the standings, and from then on the bracket, with the one it opens on first", () => {
  assert.deepEqual(orderSeasonParts(false), ["standings", "bracket"]);
  assert.deepEqual(orderSeasonParts(true), ["bracket", "standings"]);
});

test("with the header gone, a part a switch brings in stays where it was left, but never so high that the header comes back", () => {
  const reach = 126;
  assert.equal(findTopToShow(900, 400, reach), 400);
  assert.equal(findTopToShow(900, 0, reach), reach);
  assert.equal(findTopToShow(reach, 40, reach), reach);
});

test("while the header still shows, a part a switch brings in is scrolled as far as the part shown, so the header stays where it is", () => {
  const reach = 126;
  assert.equal(findTopToShow(40, 400, reach), 40);
  assert.equal(findTopToShow(0, 400, reach), 0);
});

test("where the header stays put, a part a switch brings in stays where it was left", () => {
  assert.equal(findTopToShow(900, 400, 0), 400);
  assert.equal(findTopToShow(0, 400, 0), 400);
});
