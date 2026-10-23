import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { describeRelease, isSettingsControlGesture } from "../shared/page/settings-sheet.js";
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
   * @param {FakeElement | null} [parentElement]
   */
  constructor(tag, parentElement = null) {
    super();
    this.tag = tag;
    this.parentElement = parentElement;
  }

  /**
   * @param {string} tag
   * @returns {FakeElement | null}
   */
  closest(tag) {
    return this.tag === tag ? this : (this.parentElement?.closest(tag) ?? null);
  }
}

test("settings claim pickers and their children while preserving the app's own gesture claims", (context) => {
  const originalElement = globalThis.Element;
  globalThis.Element = /** @type {any} */ (FakeElement);
  context.after(() => {
    if (originalElement) globalThis.Element = originalElement;
    else Reflect.deleteProperty(globalThis, "Element");
  });
  const select = new FakeElement("select");
  for (const target of [select, new FakeElement("option", select)])
    assert.equal(isSettingsControlGesture(target), true);
  for (const target of [new FakeElement("label"), new FakeElement("button"), new EventTarget()])
    assert.equal(isSettingsControlGesture(target), false);

  const grip = new FakeElement("button");
  const isOwnGesture = (target) => target === grip;
  assert.equal(isSettingsControlGesture(grip), false);
  assert.equal(isSettingsControlGesture(grip, isOwnGesture), true);
  assert.equal(
    isSettingsControlGesture(select, () => false),
    true,
  );
  assert.equal(isSettingsControlGesture(new EventTarget(), isOwnGesture), false);
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
