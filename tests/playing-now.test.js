import test from "node:test";
import assert from "node:assert/strict";
import { html } from "../shared/page/html.js";
import { isPlayingNow, markPlayingNow, readPlayingNow } from "../shared/page/playing-now.js";

test("a box score's players are playing now while its game is under way and once it has ended today, never before it starts or after its day", () => {
  assert.equal(isPlayingNow("live", false), true);
  assert.equal(isPlayingNow("live", true), true);
  assert.equal(isPlayingNow("final", true), true);
  assert.equal(isPlayingNow("final", false), false);
  assert.equal(isPlayingNow("pre", true), false);
  assert.equal(isPlayingNow(undefined, true), false);
});

test("a button marked as showing a player playing now tells the sheet it opens, and an unmarked one doesn't", () => {
  const button = (/** @type {boolean} */ isShownPlaying) =>
    String(html`<button data-player="1"${markPlayingNow(isShownPlaying)}>Kwan</button>`);
  assert.equal(button(true), '<button data-player="1" data-player-playing="1">Kwan</button>');
  assert.equal(button(false), '<button data-player="1">Kwan</button>');

  assert.equal(readPlayingNow({ player: "1", playerPlaying: "1" }), true);
  assert.equal(readPlayingNow({ player: "1" }), false);
});
