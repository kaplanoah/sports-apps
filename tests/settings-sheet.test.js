import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { describeRelease } from "../shared/page/settings-sheet.js";
import { normalizeSpaces, stripTags } from "./text.js";
import { EASTERN, checkInTimeZone } from "./time-zone.js";

const RELEASE = {
  version: "2.13.0",
  commit: "abc1234",
  builtAt: "2026-09-24T15:00:00Z",
  label: null,
};

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
