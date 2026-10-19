import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTimeSince, listChannelFacts, readChannelFacts } from "#shared/channel-tag.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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

test("a beta release's tag names its channel, its commit, and how long ago it went live", () => {
  const release = {
    version: "2.33.0-beta",
    commit: "3f2a91c",
    builtAt: "2026-10-18T20:00:00Z",
    label: "beta",
  };
  const now = Date.parse("2026-10-18T20:04:30Z");
  assert.deepEqual(listChannelFacts(release, now), ["beta", "3f2a91c", "4 min ago"]);
});

test("production, whose release has no label, has no tag", () => {
  const release = {
    version: "2.33.0",
    commit: "3f2a91c",
    builtAt: "2026-10-18T20:00:00Z",
    label: null,
  };
  assert.equal(listChannelFacts(release, Date.parse("2026-10-18T20:04:30Z")), null);
});

test("a release the Worker no longer has, which names only its commit, has no tag", () => {
  const release = { version: null, commit: "3f2a91c", builtAt: null, label: null };
  assert.equal(listChannelFacts(release, Date.parse("2026-10-18T20:04:30Z")), null);
});

test("a release that can't be read, as offline, leaves no tag", async () => {
  const unreadable = () => Promise.reject(new Error("version.json answered 500"));
  assert.equal(await readChannelFacts(unreadable), null);
});

test("a release read now names how long ago it went live as of now", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-18T23:00:00Z") });
  const release = {
    version: "2.33.0-beta",
    commit: "3f2a91c",
    builtAt: "2026-10-18T20:00:00Z",
    label: "beta",
  };
  assert.deepEqual(await readChannelFacts(async () => release), ["beta", "3f2a91c", "3 h ago"]);
});
