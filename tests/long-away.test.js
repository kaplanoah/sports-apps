import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const MINUTE_MS = 60 * 1000;
const PAGE_CODE = new URL("../shared/page/", import.meta.url);

// The plain script loads in the page's head, so it runs here as the page runs it, on its own.
const context = createContext({});
runInContext(readFileSync(new URL("long-away.js", PAGE_CODE), "utf8"), context);
const isAwayLong = runInContext("isAwayLong", context);
const findPlaceInPage = runInContext("findPlaceToShow", context);
/** The place the page's script finds, in this test's own objects, as it compares them. */
const findPlaceToShow = (saved, isInSheet) =>
  structuredClone(findPlaceInPage(saved, isInSheet, Date.now()));

test("two minutes away or more is long enough to start over", () => {
  assert.equal(isAwayLong(2 * MINUTE_MS - 1), false);
  assert.equal(isAwayLong(2 * MINUTE_MS), true);
});

/** What the page saved of the season's pill and standings, left far down, `awayMs` ago. */
const saveScrolledPart = (awayMs) => ({
  markup: "<div></div>",
  hidden: false,
  classes: "pager-bar held stuck",
  scrolls: [{ path: [0], left: 120, top: 40 }],
  holderTop: 868,
  pageTop: 300,
  savedAt: Date.now() - awayMs,
});

test("a part left under two minutes ago shows where it was, on the tab chosen, held as it was", () => {
  assert.deepEqual(findPlaceToShow(saveScrolledPart(MINUTE_MS), false), {
    scrolls: [{ path: [0], left: 120, top: 40, isOnStart: false }],
    holderTop: 868,
    pageTop: 300,
    classes: "pager-bar held stuck",
    isOnFirstTab: false,
  });
});

test("a part left two minutes ago or more starts over: at its top, scrolled to its start, on its first tab, with only its markup's classes", () => {
  assert.deepEqual(findPlaceToShow(saveScrolledPart(2 * MINUTE_MS), false), {
    scrolls: [{ path: [0], left: 0, top: 0, isOnStart: false }],
    holderTop: 0,
    pageTop: 0,
    classes: "",
    isOnFirstTab: true,
  });
});

test("a list that names where it starts goes there after two minutes, and stays where it was before", () => {
  const saveList = (awayMs) => ({
    scrolls: [{ path: [1, 0], left: 0, top: 900, startTop: 2400 }],
    savedAt: Date.now() - awayMs,
  });

  assert.deepEqual(findPlaceToShow(saveList(MINUTE_MS), false).scrolls, [
    { path: [1, 0], left: 0, top: 900, isOnStart: false },
  ]);
  assert.deepEqual(findPlaceToShow(saveList(2 * MINUTE_MS), false).scrolls, [
    { path: [1, 0], left: 0, top: 2400, isOnStart: true },
  ]);
});

test("a part in a sheet stays where it was after two minutes, as long as the sheet does", () => {
  const place = findPlaceToShow(saveScrolledPart(2 * MINUTE_MS), true);

  assert.deepEqual(place.scrolls, [{ path: [0], left: 120, top: 40, isOnStart: false }]);
  assert.equal(place.classes, "pager-bar held stuck");
  assert.equal(place.isOnFirstTab, false);
});

test("a part saved at a time that can't be read starts over", () => {
  assert.equal(findPlaceToShow({ savedAt: "never" }, false).isOnFirstTab, true);
});

test("only long-away.js keeps the two minutes, which the page's other code reads from it", () => {
  const keepers = readdirSync(PAGE_CODE).filter(
    (name) =>
      name.endsWith(".js") &&
      /const \w*AFTER_AWAY_MS\b/.test(readFileSync(new URL(name, PAGE_CODE), "utf8")),
  );
  assert.deepEqual(keepers, ["long-away.js"]);
});
