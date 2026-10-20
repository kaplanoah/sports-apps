import { test } from "node:test";
import assert from "node:assert/strict";
import { markBarHeld, markBarStuck } from "#shared/held-bar.js";

/**
 * A bar whose classes are the set given.
 * @param {Set<string>} classes
 */
const makeBar = (classes) =>
  /** @type {Element} */ (
    /** @type {unknown} */ ({
      classList: {
        toggle: (/** @type {string} */ name, /** @type {boolean} */ isOn) =>
          isOn ? classes.add(name) : classes.delete(name),
      },
    })
  );

/**
 * Whether the bar ends in its line with the list scrolled to `scrollTop`.
 * @param {number} scrollTop
 * @param {number} [heldAt]
 */
const isStuck = (scrollTop, heldAt) => {
  const classes = new Set();
  markBarStuck(makeBar(classes), /** @type {Element} */ ({ scrollTop }), heldAt);
  return classes.has("stuck");
};

test("a bar ends in its line once its list has scrolled half a pixel under it, but not for the fraction of a pixel a phone can leave a list at rest", () => {
  assert.equal(isStuck(0), false);
  assert.equal(isStuck(1 / 3), false);
  assert.equal(isStuck(0.5), true);
  assert.equal(isStuck(40), true);
});

test("a bar held only once its list has scrolled some way ends in its line only past there", () => {
  const heldAt = 126;
  assert.equal(isStuck(heldAt - 40, heldAt), false);
  assert.equal(isStuck(heldAt, heldAt), false);
  assert.equal(isStuck(heldAt + 1 / 3, heldAt), false);
  assert.equal(isStuck(heldAt + 0.5, heldAt), true);
});

/**
 * Whether the bar holds with the list scrolled to `scrollTop`.
 * @param {number} scrollTop
 * @param {number} heldAt
 */
const isHeld = (scrollTop, heldAt) => {
  const classes = new Set();
  markBarHeld(makeBar(classes), /** @type {Element} */ ({ scrollTop }), heldAt);
  return classes.has("held");
};

test("a bar holds once its list has scrolled as far as it rides, but for the fraction of a pixel a phone can leave a list short, before it ends in its line", () => {
  const heldAt = 126;
  assert.equal(isHeld(heldAt - 1, heldAt), false);
  assert.equal(isHeld(heldAt - 1 / 3, heldAt), true);
  assert.equal(isHeld(heldAt, heldAt), true);
  assert.equal(isHeld(heldAt + 40, heldAt), true);
});

test("a bar over no list leaves its line off", () => {
  const classes = new Set(["stuck"]);
  markBarStuck(makeBar(classes), null);
  assert.equal(classes.has("stuck"), false);
});
