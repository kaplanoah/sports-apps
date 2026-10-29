import assert from "node:assert/strict";
import { test } from "node:test";
import { DRIFT_PX, findPressed, isPastDrift, isPressable } from "../shared/page/press.js";

/**
 * A stand-in for an element, with what press.js reads of one.
 * @param {string} localName
 * @param {{ attributes?: Record<string, string>, classes?: string[], parent?: FakeElement }} [parts]
 * @typedef {ReturnType<typeof createElement>} FakeElement
 */
function createElement(localName, { attributes = {}, classes = [], parent } = {}) {
  const tappable = new Set(["button", "a", "label", "summary", "select", "input", "textarea"]);
  /** @type {any} */
  const element = {
    localName,
    getAttribute: (/** @type {string} */ name) => attributes[name] ?? null,
    hasAttribute: (/** @type {string} */ name) => name in attributes,
    classList: { contains: (/** @type {string} */ name) => classes.includes(name) },
    /** @param {string} selector */
    matches: (selector) =>
      selector.split(", ").some((part) => part.startsWith(".") && classes.includes(part.slice(1))),
    /** @param {string} selector */
    closest(selector) {
      const isLabel = selector === "label";
      const matches = isLabel
        ? localName === "label"
        : tappable.has(localName) && (localName !== "a" || "href" in attributes);
      return matches ? element : (parent?.closest(selector) ?? null);
    },
  };
  return element;
}

test("a button, a link, a details' summary, an Appearance choice, and Contact's Add screenshot show their press", () => {
  assert.equal(isPressable(createElement("button")), true);
  assert.equal(isPressable(createElement("a", { attributes: { href: "#" } })), true);
  assert.equal(isPressable(createElement("summary")), true);
  assert.equal(isPressable(createElement("label", { classes: ["appearance-choice"] })), true);
  assert.equal(isPressable(createElement("label", { classes: ["contact-secondary"] })), true);
});

test("a switch, a disabled button, a link with nowhere to go, a select, a field, and a plain label never show one", () => {
  assert.equal(isPressable(createElement("button", { attributes: { role: "switch" } })), false);
  assert.equal(isPressable(createElement("button", { attributes: { disabled: "" } })), false);
  assert.equal(isPressable(createElement("a")), false);
  assert.equal(isPressable(createElement("select")), false);
  assert.equal(isPressable(createElement("input")), false);
  assert.equal(isPressable(createElement("textarea")), false);
  assert.equal(isPressable(createElement("label")), false);
});

test("a press on what a button holds shows on the button", () => {
  const button = createElement("button");

  assert.equal(findPressed(createElement("span", { parent: button })), button);
});

test("a press on an Appearance choice's radio, which lies over its label, shows on the label", () => {
  const choice = createElement("label", { classes: ["appearance-choice"] });

  assert.equal(findPressed(createElement("input", { parent: choice })), choice);
});

test("a press on a switch, or on what takes no tap, shows nowhere", () => {
  const notifications = createElement("button", { attributes: { role: "switch" } });

  assert.equal(findPressed(createElement("span", { parent: notifications })), null);
  assert.equal(findPressed(createElement("div")), null);
});

test("a finger drifts past where its press lets go only once it's farther than DRIFT_PX from where it landed, in any direction", () => {
  assert.equal(isPastDrift(0, DRIFT_PX), false);
  assert.equal(isPastDrift(-DRIFT_PX, 0), false);
  assert.equal(isPastDrift(7, -7), false);
  assert.equal(isPastDrift(0, DRIFT_PX + 1), true);
  assert.equal(isPastDrift(-(DRIFT_PX + 1), 0), true);
  assert.equal(isPastDrift(8, -7), true);
});
