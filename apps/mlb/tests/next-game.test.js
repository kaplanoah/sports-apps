import test from "node:test";
import assert from "node:assert/strict";
import { findGameUnderWay, findNextGame, isNextShown } from "../page/js/next-game.js";

const NOW = Date.parse("2026-09-24T23:00:00Z");
const NEXT = { at: "2026-09-24T23:05:00Z", tbd: false };
const THEN = { at: "2026-09-25T23:05:00Z", tbd: false };

test("a club's next game is its row's next until that one starts, then the one after it", () => {
  const row = { next: NEXT, then: THEN };
  assert.equal(findNextGame(row, NOW), NEXT);
  assert.equal(findNextGame(row, Date.parse(NEXT.at)), THEN);
  assert.equal(findNextGame(row, Date.parse(THEN.at)), null);
  assert.equal(findNextGame({ next: { ...NEXT, tbd: true } }, Date.parse(THEN.at)).tbd, true);
});

test("a club out of the race shows its next game only when it's a playoff game", () => {
  assert.equal(isNextShown(NEXT, false), true);
  assert.equal(isNextShown(NEXT, true), false);
  assert.equal(isNextShown({ ...NEXT, postseason: true }, true), true);
  assert.equal(isNextShown(null, false), false);
});

test("a club's game under way is the one live, or else one past its start or already delayed", () => {
  const game = (away, state, start, extra = {}) => ({ away, home: "NYY", state, start, ...extra });
  const live = game("BOS", "live", "2026-09-24T22:05:00Z");
  const warmup = game("TB", "pre", "2026-09-24T22:55:00Z");
  const delayed = game("TOR", "pre", "2026-09-24T23:30:00Z", { delay: "Delayed Start: Rain" });
  const later = game("BAL", "pre", "2026-09-24T23:30:00Z");
  assert.equal(findGameUnderWay([warmup, live], "NYY", NOW), live);
  assert.equal(findGameUnderWay([warmup], "TB", NOW), warmup);
  assert.equal(findGameUnderWay([delayed], "TOR", NOW), delayed);
  assert.equal(findGameUnderWay([later], "BAL", NOW), null);
  assert.equal(findGameUnderWay([{ ...warmup, tbd: true }], "TB", NOW), null);
  assert.equal(findGameUnderWay([live], "SEA", NOW), null);
});
