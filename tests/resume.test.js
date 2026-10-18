import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseTickStep, hasBeenAway, isReplaced } from "../shared/page/resume.js";

const SECOND_MS = 1000;

test("a deploy has replaced the page only when both releases are known and their commits differ", () => {
  const loaded = { commit: "abc1234", version: "1.0.0", builtAt: "", label: null };
  assert.equal(isReplaced(loaded, { ...loaded, commit: "def5678" }), true);
  assert.equal(isReplaced(loaded, loaded), false);
  assert.equal(isReplaced(null, loaded), false);
  assert.equal(isReplaced(loaded, null), false);
});

test("a page back from being hidden was away, however briefly, and one never hidden only after a minute asleep", () => {
  assert.equal(hasBeenAway({ wasHidden: true, awayMs: SECOND_MS }), true);
  assert.equal(hasBeenAway({ wasHidden: false, awayMs: 59 * SECOND_MS }), false);
  assert.equal(hasBeenAway({ wasHidden: false, awayMs: 60 * SECOND_MS }), true);
});

test("a tick reloads once a waiting reload can, catches up after a minute asleep, and tries a release check again until one answers", () => {
  const awake = { isReloadPending: false, awayMs: 15 * SECOND_MS, isReleaseCheckOwed: false };
  assert.equal(chooseTickStep(awake), "none");
  assert.equal(chooseTickStep({ ...awake, isReleaseCheckOwed: true }), "check-release");
  assert.equal(chooseTickStep({ ...awake, awayMs: 60 * SECOND_MS }), "catch-up");
  assert.equal(
    chooseTickStep({ isReloadPending: true, awayMs: 60 * SECOND_MS, isReleaseCheckOwed: true }),
    "reload",
  );
});
