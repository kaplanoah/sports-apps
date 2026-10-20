import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollWithSpring } from "../shared/page/spring-scroll.js";

// Stand-ins for the window: its events, its animation frames, and full motion.
const page = new EventTarget();
/** @type {number[]} */
const cancelledFrames = [];
let nextFrame = 1;
Object.assign(globalThis, {
  addEventListener: page.addEventListener.bind(page),
  removeEventListener: page.removeEventListener.bind(page),
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: () => nextFrame++,
  cancelAnimationFrame: (/** @type {number} */ frame) => cancelledFrames.push(frame),
});

// A list that scrolls where it's told.
const createScroller = () =>
  /** @type {any} */ ({
    scrollTop: 0,
    /** @param {{ top: number }} options */
    scrollTo({ top }) {
      this.scrollTop = top;
    },
  });

test("a key pressed while the spring scrolls stops it where it is and says what stopped it, once", () => {
  /** @type {Event[]} */
  const interruptions = [];
  scrollWithSpring(createScroller(), 800, (event) => interruptions.push(event));
  const frame = nextFrame - 1;
  cancelledFrames.length = 0;

  const key = new Event("keydown");
  page.dispatchEvent(key);
  page.dispatchEvent(new Event("keydown"));

  assert.deepEqual(interruptions, [key]);
  assert.deepEqual(cancelledFrames, [frame]);
});

test("a spring that a new scroll replaces isn't told it was stopped short", () => {
  /** @type {Event[]} */
  const interruptions = [];
  const scroller = createScroller();
  scrollWithSpring(scroller, 800, (event) => interruptions.push(event));

  scrollWithSpring(scroller, 400);
  page.dispatchEvent(new Event("keydown"));

  assert.deepEqual(interruptions, []);
});
