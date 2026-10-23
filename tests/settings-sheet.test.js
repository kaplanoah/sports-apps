import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { describeRelease } from "../shared/page/settings-sheet.js";
import { isSheetControlGesture } from "../shared/page/sheet-swipe.js";
import { normalizeSpaces, stripTags } from "./text.js";
import { EASTERN, checkInTimeZone } from "./time-zone.js";

const RELEASE = {
  version: "2.13.0",
  commit: "abc1234",
  builtAt: "2026-09-24T15:00:00Z",
  label: null,
};

class FakeElement extends EventTarget {
  /**
   * @param {string} tag
   * @param {string} [className]
   * @param {FakeElement | null} [parentElement]
   */
  constructor(tag, className = "", parentElement = null) {
    super();
    this.tag = tag;
    this.className = className;
    this.parentElement = parentElement;
  }

  /**
   * @param {string} selectors
   * @returns {FakeElement | null}
   */
  closest(selectors) {
    const matches = selectors.split(",").some((selector) => {
      const name = selector.trim();
      return name.startsWith(".")
        ? this.className.split(/\s+/).includes(name.slice(1))
        : this.tag === name;
    });
    return matches ? this : (this.parentElement?.closest(selectors) ?? null);
  }
}

test("settings leave a select, a ranking grip, and their children in charge of their own gestures", (context) => {
  const originalElement = globalThis.Element;
  globalThis.Element = /** @type {any} */ (FakeElement);
  context.after(() => {
    if (originalElement) globalThis.Element = originalElement;
    else Reflect.deleteProperty(globalThis, "Element");
  });
  const select = new FakeElement("select");
  const grip = new FakeElement("button", "grip");
  for (const target of [
    select,
    new FakeElement("option", "", select),
    grip,
    new FakeElement("svg", "", grip),
  ])
    assert.equal(isSheetControlGesture(target), true);
  for (const target of [new FakeElement("label"), new FakeElement("button"), new EventTarget()])
    assert.equal(isSheetControlGesture(target), false);
});

/** @param {import("../shared/page/release.js").Release} release */
const readReleaseLine = (release) =>
  checkInTimeZone(EASTERN, () => {
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T12:00:00Z") });
    try {
      const line = describeRelease(release);
      return stripTags(normalizeSpaces(line).replace(/&bull;/g, " | "));
    } finally {
      mock.timers.reset();
    }
  });

test("a release from this year names its day and time without the year", () => {
  assert.equal(readReleaseLine(RELEASE), "v2.13.0 | Released Sep 24, 11:00 AM");
});

test("a release from an earlier year names its year", () => {
  assert.equal(
    readReleaseLine({ ...RELEASE, builtAt: "2025-10-02T15:00:00Z" }),
    "v2.13.0 | Released Oct 2, 2025, 11:00 AM",
  );
});

test("a release without a version names its commit", () => {
  assert.equal(
    readReleaseLine({ ...RELEASE, version: null }),
    "abc1234 | Released Sep 24, 11:00 AM",
  );
});
