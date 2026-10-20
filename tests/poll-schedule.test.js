import test from "node:test";
import assert from "node:assert/strict";
import { choosePollDelay, OFF_DAY_CHECK_MS } from "../shared/page/poll-schedule.js";

const NOW = Date.parse("2026-09-24T22:00:00Z");
const LIVE_MS = 30 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** @param {{ isLive?: boolean, starts?: number[] }} games */
const choose = ({ isLive = false, starts = [] }) =>
  choosePollDelay({ isLive, starts, liveMs: LIVE_MS, now: NOW });

test("a game under way is followed at the league's live pace", () => {
  assert.equal(choose({ isLive: true, starts: [NOW + 5 * HOUR_MS] }), LIVE_MS);
});

test("the next update waits until fifteen minutes before the next start", () => {
  assert.equal(choose({ starts: [NOW + 40 * MINUTE_MS] }), 25 * MINUTE_MS);
  assert.equal(choose({ starts: [NOW + 10 * MINUTE_MS] }), LIVE_MS);
});

test("on a game day, the schedule is checked every three hours until the lead", () => {
  assert.equal(choose({ starts: [NOW + 19 * HOUR_MS] }), 3 * HOUR_MS);
});

test("with no game within a day, or none at all, the schedule is checked once a day", () => {
  assert.equal(choose({ starts: [NOW + 30 * HOUR_MS] }), OFF_DAY_CHECK_MS);
  assert.equal(choose({ starts: [NOW + 150 * 24 * HOUR_MS] }), OFF_DAY_CHECK_MS);
  assert.equal(choose({}), OFF_DAY_CHECK_MS);
  assert.equal(choose({ starts: [NaN] }), OFF_DAY_CHECK_MS);
});

test("a game put off within a day isn't followed as late, but keeps the day a game day", () => {
  const putOff = (/** @type {number} */ start) =>
    choosePollDelay({
      isLive: false,
      starts: [],
      putOffStarts: [start],
      liveMs: LIVE_MS,
      now: NOW,
    });
  assert.equal(putOff(NOW - 30 * MINUTE_MS), 3 * HOUR_MS);
  assert.equal(putOff(NOW + 5 * HOUR_MS), 3 * HOUR_MS);
  assert.equal(putOff(NOW - 30 * HOUR_MS), OFF_DAY_CHECK_MS);
  assert.equal(putOff(NOW + 30 * HOUR_MS), OFF_DAY_CHECK_MS);
});

test("a delayed start is followed closely at first, then less, and dropped after eight hours", () => {
  assert.equal(choose({ starts: [NOW - 55 * MINUTE_MS] }), LIVE_MS);
  assert.equal(choose({ starts: [NOW - 90 * MINUTE_MS] }), MINUTE_MS);
  assert.equal(choose({ starts: [NOW - 7 * HOUR_MS] }), 5 * MINUTE_MS);
  assert.equal(choose({ starts: [NOW - 9 * HOUR_MS] }), OFF_DAY_CHECK_MS);
});

test("a delayed start doesn't hold off a game about to start", () => {
  assert.equal(choose({ starts: [NOW - 3 * HOUR_MS, NOW + 10 * MINUTE_MS] }), LIVE_MS);
});
