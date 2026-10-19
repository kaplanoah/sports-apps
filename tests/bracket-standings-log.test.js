import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bracketStandingsLog,
  describeTouchEnd,
  watchTouches,
} from "../shared/page/bracket-standings-log.js";
import { useSavedStorage } from "./saved-storage.js";

useSavedStorage(new Map());
globalThis.document = /** @type {any} */ ({ addEventListener: () => {} });
/** @type {Map<string, (event: any) => void>} */
const windowListeners = new Map();
globalThis.addEventListener = /** @type {any} */ (
  (/** @type {string} */ type, /** @type {(event: any) => void} */ listener) =>
    windowListeners.set(type, listener)
);
globalThis.scrollY = 0;

/** A stand-in for an element, on the standings and bracket when `isOnParts`. */
class FakeElement {
  /** @param {boolean} isOnParts */
  constructor(isOnParts) {
    this.isOnParts = isOnParts;
  }
  closest() {
    return this.isOnParts ? this : null;
  }
}
globalThis.Element = /** @type {any} */ (FakeElement);

bracketStandingsLog.watchSteps(
  () => true,
  () => {},
);
watchTouches();

/**
 * Sends the window a touch's event, with a finger at each of `points`.
 * @param {string} type
 * @param {{ target: FakeElement, points: { x: number, y: number }[], defaultPrevented?: boolean }} touch
 */
function sendTouch(type, { target, points, defaultPrevented = false }) {
  const touches = points.map(({ x, y }) => ({ clientX: x, clientY: y }));
  windowListeners.get(type)?.({ type, target, touches, defaultPrevented });
}

/** The log's lines from the touches `sendTouches` sends. */
function readLiftsFrom(/** @type {() => void} */ sendTouches) {
  bracketStandingsLog.forgetLines();
  sendTouches();
  return bracketStandingsLog.readLines().map((line) => line.text);
}

test("a touch on the standings and bracket is logged as it lifts, with where the page's code took it", () => {
  const target = new FakeElement(true);
  const lines = readLiftsFrom(() => {
    sendTouch("touchstart", { target, points: [{ x: 100, y: 200 }] });
    sendTouch("touchmove", { target, points: [{ x: 97, y: 200 }] });
    sendTouch("touchmove", { target, points: [{ x: 93, y: 201 }], defaultPrevented: true });
    sendTouch("touchmove", { target, points: [{ x: 70, y: 203 }], defaultPrevented: true });
    sendTouch("touchend", { target, points: [] });
  });
  assert.deepEqual(lines, [
    "lifted after moving 30 left and 3 down; the page's code took the touch once it had moved 7 left and 1 down; the page didn't scroll",
  ]);
});

test("a touch elsewhere on the page, or one a second finger joins, isn't logged", () => {
  const elsewhere = new FakeElement(false);
  const onParts = new FakeElement(true);
  const lines = readLiftsFrom(() => {
    sendTouch("touchstart", { target: elsewhere, points: [{ x: 100, y: 200 }] });
    sendTouch("touchmove", { target: elsewhere, points: [{ x: 70, y: 200 }] });
    sendTouch("touchend", { target: elsewhere, points: [] });
    sendTouch("touchstart", { target: onParts, points: [{ x: 100, y: 200 }] });
    sendTouch("touchmove", {
      target: onParts,
      points: [
        { x: 100, y: 190 },
        { x: 200, y: 300 },
      ],
    });
    sendTouch("touchend", { target: onParts, points: [{ x: 200, y: 300 }] });
  });
  assert.deepEqual(lines, []);
});

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
      moved: { x: -0.4, y: 80 },
      takenAt: null,
      scrolled: -160,
    }),
    "lifted after moving 80 down; the browser kept the touch; the page scrolled 160px up",
  );
});

test("a touch the browser cancels says so, and one that didn't move says that", () => {
  assert.equal(
    describeTouchEnd({ isCancelled: true, moved: { x: 0.3, y: 0 }, takenAt: null, scrolled: 0 }),
    "cancelled without moving; the browser kept the touch; the page didn't scroll",
  );
  assert.equal(
    describeTouchEnd({
      isCancelled: false,
      moved: { x: 0, y: -0.2 },
      takenAt: { x: 0, y: 0 },
      scrolled: 0,
    }),
    "lifted without moving; the page's code took the touch before it moved; the page didn't scroll",
  );
});
