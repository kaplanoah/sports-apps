import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTouchEnd } from "../shared/page/bracket-standings-log.js";

test("a touch the page's code took says how far the finger had moved when it did, and that the page didn't scroll", () => {
  assert.equal(
    describeTouchEnd({
      isCancelled: false,
      moved: { x: 9.4, y: -14.2 },
      takenAt: { x: 6.6, y: -2 },
      scrolled: 0,
    }),
    "lifted after moving 9 right and 14 up; the page's code took the touch once it had moved 7 right and 2 up; the page didn't scroll",
  );
});

test("a touch the browser kept says how far the page scrolled, and which way", () => {
  assert.equal(
    describeTouchEnd({
      isCancelled: false,
      moved: { x: -3, y: -120 },
      takenAt: null,
      scrolled: 240.5,
    }),
    "lifted after moving 3 left and 120 up; the browser kept the touch; the page scrolled 241px down",
  );
  assert.equal(
    describeTouchEnd({
      isCancelled: false,
      moved: { x: 0, y: 80 },
      takenAt: null,
      scrolled: -160,
    }),
    "lifted after moving 0 right and 80 down; the browser kept the touch; the page scrolled 160px up",
  );
});

test("a touch the browser cancels says so", () => {
  assert.equal(
    describeTouchEnd({ isCancelled: true, moved: { x: 0, y: 0 }, takenAt: null, scrolled: 0 }),
    "cancelled after moving 0 right and 0 down; the browser kept the touch; the page didn't scroll",
  );
});
