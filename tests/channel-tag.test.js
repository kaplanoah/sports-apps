import { test } from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "./repo-files.js";
import { createContext, runInContext } from "node:vm";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

class HTMLTimeElement {
  dateTime = "";
  textContent = "";
}

// The plain script loads in the page's head, so it runs here as the page runs it, on its own,
// with a page whose tag holds `time` and this test's clock.
const tagTime = new HTMLTimeElement();
const context = createContext({
  HTMLTimeElement,
  get Date() {
    return Date;
  },
  document: { querySelector: (selector) => (selector === "#channelTag time" ? tagTime : null) },
});
runInContext(readRepoFile("shared/page/draw-channel-tag-age.js"), context);
const describeTimeSince = runInContext("describeTimeSince", context);
const drawChannelTagAge = runInContext("drawChannelTagAge", context);

test("how long ago reads just now, then minutes, whole hours, and days", () => {
  const ages = [
    [0, "just now"],
    [59 * 1000, "just now"],
    [MINUTE_MS, "1 min ago"],
    [4 * MINUTE_MS + 59 * 1000, "4 min ago"],
    [59 * MINUTE_MS, "59 min ago"],
    [HOUR_MS, "1 h ago"],
    [3 * HOUR_MS + 40 * MINUTE_MS, "3 h ago"],
    [23 * HOUR_MS + 59 * MINUTE_MS, "23 h ago"],
    [DAY_MS, "1 day ago"],
    [DAY_MS + 23 * HOUR_MS, "1 day ago"],
    [2 * DAY_MS, "2 days ago"],
    [16 * DAY_MS, "16 days ago"],
  ];
  assert.deepEqual(
    ages.map(([ms]) => describeTimeSince(Number(ms))),
    ages.map(([, words]) => words),
  );
});

test("the tag's age reads how long ago its deploy went live, as of now", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-18T23:00:00Z") });
  tagTime.dateTime = "2026-10-18T20:00:00.000Z";
  drawChannelTagAge();
  assert.equal(tagTime.textContent, "3 h ago");
});
