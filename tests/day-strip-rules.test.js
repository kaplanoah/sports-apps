import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseCellLabel,
  choosePlacement,
  chooseTrip,
  describeWhyNoSlide,
  findDayScrollTop,
  isFollowingStartDay,
  isRowOutOfSight,
  listShownDays,
  listStripDays,
  readFollowStartUntil,
} from "../shared/page/day-strip-rules.js";

const SECOND_MS = 1000;

/** @param {string} day */
const listedDay = (day) => ({ day, markup: /** @type {any} */ (day) });

test("the strip holds every day from the first game day to the last, across a month's end", () => {
  const days = ["2026-05-30", "2026-06-02"].map(listedDay);
  assert.deepEqual(listStripDays(days), ["2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"]);
  assert.deepEqual(listStripDays([listedDay("2026-06-02")]), ["2026-06-02"]);
  assert.deepEqual(listStripDays([]), []);
});

test("a day in the strip is named Today, its month on the first, and otherwise its weekday", () => {
  assert.equal(chooseCellLabel("2026-06-10", "2026-06-10"), "today");
  assert.equal(chooseCellLabel("2026-07-01", "2026-07-01"), "today");
  assert.equal(chooseCellLabel("2026-07-01", "2026-06-10"), "month");
  assert.equal(chooseCellLabel("2026-07-02", "2026-06-10"), "weekday");
  assert.equal(chooseCellLabel("2026-06-30", "2026-06-10"), "weekday");
});

test("a date without games a tap brought in shows in its place among the game days", () => {
  const days = ["2026-06-01", "2026-06-03"].map(listedDay);
  const renderQuietDay = (/** @type {string} */ day) => /** @type {any} */ (`No games ${day}`);
  const listShown = (/** @type {string | null} */ quietDay) =>
    listShownDays(days, quietDay, renderQuietDay).map(({ day }) => day);
  assert.deepEqual(listShown("2026-06-02"), ["2026-06-01", "2026-06-02", "2026-06-03"]);
  assert.deepEqual(listShown("2026-05-31"), ["2026-05-31", "2026-06-01", "2026-06-03"]);
  assert.deepEqual(listShown("2026-06-04"), ["2026-06-01", "2026-06-03", "2026-06-04"]);
  assert.equal(listShownDays(days, "2026-06-02", renderQuietDay)[1].markup, "No games 2026-06-02");
  assert.equal(listShownDays(days, null, renderQuietDay), days);
  assert.equal(listShownDays(days, "2026-06-03", renderQuietDay), days);
});

test("a list opens where it last was, else on the day the page put back, else on its start day", () => {
  assert.equal(choosePlacement({ isPlaced: true, hasPutBackDay: true }), "last place");
  assert.equal(choosePlacement({ isPlaced: true, hasPutBackDay: false }), "last place");
  assert.equal(choosePlacement({ isPlaced: false, hasPutBackDay: true }), "put back");
  assert.equal(choosePlacement({ isPlaced: false, hasPutBackDay: false }), "start day");
});

test("the list stands with a day a gap under its top, or as near as its ends let it", () => {
  const list = { gap: 12, scrollHeight: 5000, clientHeight: 800 };
  assert.equal(findDayScrollTop({ ...list, dayTop: 1000 }), 988);
  assert.equal(findDayScrollTop({ ...list, dayTop: 4 }), 0);
  assert.equal(findDayScrollTop({ ...list, dayTop: 4900 }), 4200);
  assert.equal(findDayScrollTop({ ...list, dayTop: 4212 }), 4200);
});

test("the list flies to a day within three screens and jumps when asked, farther, or with less motion", () => {
  const trip = {
    motion: /** @type {const} */ ("flown"),
    screenHeight: 800,
    isReducedMotion: false,
  };
  assert.equal(chooseTrip({ ...trip, distance: 2400 }), "fly");
  assert.equal(chooseTrip({ ...trip, distance: -2400 }), "fly");
  assert.equal(chooseTrip({ ...trip, distance: 2401 }), "jump");
  assert.equal(chooseTrip({ ...trip, distance: -2401 }), "jump");
  assert.equal(chooseTrip({ ...trip, distance: 100, motion: "instant" }), "jump");
  assert.equal(chooseTrip({ ...trip, distance: 100, isReducedMotion: true }), "jump");
});

test("the strip's dates slide to the top day only while a finger or wheel moves the list, with motion", () => {
  const state = { hasCells: true, isListInHand: true, isReducedMotion: false };
  assert.equal(describeWhyNoSlide(state), null);
  assert.equal(describeWhyNoSlide({ ...state, hasCells: false }), "a date isn't in the strip");
  assert.equal(
    describeWhyNoSlide({ ...state, isListInHand: false }),
    "no finger or wheel moved the list",
  );
  assert.equal(describeWhyNoSlide({ ...state, isReducedMotion: true }), "less motion");
});

test("a list back from a long time away follows its start day for ten seconds while held on it", () => {
  const now = 1_000_000;
  const followStartUntil = readFollowStartUntil(now);
  assert.equal(followStartUntil, now + 10 * SECOND_MS);
  const state = {
    now: now + 9 * SECOND_MS,
    followStartUntil,
    heldDay: "2026-06-01",
    lastStartDay: "2026-06-01",
    startDay: "2026-06-02",
  };
  assert.equal(isFollowingStartDay(state), true);
  assert.equal(isFollowingStartDay({ ...state, now: followStartUntil }), false);
  assert.equal(isFollowingStartDay({ ...state, heldDay: "2026-05-30" }), false);
  assert.equal(isFollowingStartDay({ ...state, heldDay: null }), false);
  assert.equal(isFollowingStartDay({ ...state, startDay: "2026-06-01" }), false);
});

test("a row is out of sight only once all of it is above or below what the list shows", () => {
  const list = { scrollTop: 1000, clientHeight: 800 };
  const row = { rowHeight: 60 };
  assert.equal(isRowOutOfSight({ ...list, ...row, rowTop: 940 }), true);
  assert.equal(isRowOutOfSight({ ...list, ...row, rowTop: 941 }), false);
  assert.equal(isRowOutOfSight({ ...list, ...row, rowTop: 1799 }), false);
  assert.equal(isRowOutOfSight({ ...list, ...row, rowTop: 1800 }), true);
});
