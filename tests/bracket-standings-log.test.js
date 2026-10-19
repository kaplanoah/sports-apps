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
/** A stand-in for an element in the season part `part` names, which it stands in for too, or none. */
class FakeElement {
  /** @param {"standings" | "bracket" | null} part */
  constructor(part) {
    this.dataset = { part };
    this.scrollTop = 0;
  }
  /** @param {string} selector */
  closest(selector) {
    return selector === ".season-part" && this.dataset.part ? this : null;
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

/**
 * Sends the window the cancel of a pointer, as the browser does once it takes a touch for a scroll.
 * @param {{ isPrimary: boolean }} pointer
 */
const sendPointerCancel = ({ isPrimary }) =>
  windowListeners.get("pointercancel")?.({ type: "pointercancel", isPrimary });

/** The log's lines from the touches `sendTouches` sends. */
function readLiftsFrom(/** @type {() => void} */ sendTouches) {
  bracketStandingsLog.forgetLines();
  sendTouches();
  return bracketStandingsLog.readLines().map((line) => line.text);
}

test("a touch on the standings and bracket is logged as it lifts, with where the page's code took it, whether the browser cancelled its pointer, and how far the part under it scrolled", () => {
  const target = new FakeElement("standings");
  const bracket = new FakeElement("bracket");
  const lines = readLiftsFrom(() => {
    sendTouch("touchstart", { target, points: [{ x: 100, y: 200 }] });
    sendTouch("touchmove", { target, points: [{ x: 97, y: 200 }] });
    sendTouch("touchmove", { target, points: [{ x: 93, y: 201 }], defaultPrevented: true });
    sendTouch("touchmove", { target, points: [{ x: 70, y: 203 }], defaultPrevented: true });
    sendTouch("touchend", { target, points: [] });
    sendTouch("touchstart", { target, points: [{ x: 100, y: 400 }] });
    sendTouch("touchmove", { target, points: [{ x: 100, y: 200 }] });
    sendPointerCancel({ isPrimary: true });
    target.scrollTop = 240;
    sendTouch("touchend", { target, points: [] });
    sendTouch("touchstart", { target: bracket, points: [{ x: 100, y: 200 }] });
    sendTouch("touchmove", { target: bracket, points: [{ x: 100, y: 300 }] });
    sendPointerCancel({ isPrimary: false });
    bracket.scrollTop = -60;
    sendTouch("touchend", { target: bracket, points: [] });
  });
  assert.deepEqual(lines, [
    "lifted after moving 30 left and 3 down; the page's code took the touch once it had moved 7 left and 1 down; its pointer wasn't cancelled; the standings didn't scroll",
    "lifted after moving 200 up; the browser kept the touch; its pointer was cancelled; the standings scrolled 240px down",
    "lifted after moving 100 down; the browser kept the touch; its pointer wasn't cancelled; the bracket scrolled 60px up",
  ]);
});

test("a touch elsewhere on the page, or one a second finger joins, isn't logged", () => {
  const elsewhere = new FakeElement(null);
  const onParts = new FakeElement("standings");
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

test("a touch the page's code took says how far the finger had moved when it did, and that its part didn't scroll", () => {
  assert.equal(
    describeTouchEnd({
      isCancelled: false,
      moved: { x: 9.4, y: -14.2 },
      takenAt: { x: 6.6, y: -2 },
      isPointerCancelled: false,
      part: "standings",
      scrolled: 0,
    }),
    "lifted after moving 9 right and 14 up; the page's code took the touch once it had moved 7 right and 2 up; its pointer wasn't cancelled; the standings didn't scroll",
  );
});

test("a touch the browser kept says whether it cancelled its pointer, and how far its part scrolled, and which way", () => {
  assert.equal(
    describeTouchEnd({
      isCancelled: false,
      moved: { x: -3, y: -120 },
      takenAt: null,
      isPointerCancelled: true,
      part: "standings",
      scrolled: 240.5,
    }),
    "lifted after moving 3 left and 120 up; the browser kept the touch; its pointer was cancelled; the standings scrolled 241px down",
  );
  assert.equal(
    describeTouchEnd({
      isCancelled: false,
      moved: { x: -0.4, y: 80 },
      takenAt: null,
      isPointerCancelled: false,
      part: "bracket",
      scrolled: -160,
    }),
    "lifted after moving 80 down; the browser kept the touch; its pointer wasn't cancelled; the bracket scrolled 160px up",
  );
});

test("a touch the browser cancels says so, and one that didn't move says that", () => {
  assert.equal(
    describeTouchEnd({
      isCancelled: true,
      moved: { x: 0.3, y: 0 },
      takenAt: null,
      isPointerCancelled: true,
      part: "bracket",
      scrolled: 0,
    }),
    "cancelled without moving; the browser kept the touch; its pointer was cancelled; the bracket didn't scroll",
  );
  assert.equal(
    describeTouchEnd({
      isCancelled: false,
      moved: { x: 0, y: -0.2 },
      takenAt: { x: 0, y: 0 },
      isPointerCancelled: false,
      part: "standings",
      scrolled: 0,
    }),
    "lifted without moving; the page's code took the touch before it moved; its pointer wasn't cancelled; the standings didn't scroll",
  );
});
