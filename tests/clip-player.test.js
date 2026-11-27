import { test } from "node:test";
import assert from "node:assert/strict";
import { pickClipAddress } from "../shared/page/clip-player.js";

const ADDRESSES = { video: "https://video.test/1.mp4", stream: "https://video.test/1.m3u8" };

/** @param {string} answer what the browser says of a stream */
const describePlayer = (answer) => ({
  canPlayType: (/** @type {string} */ type) =>
    type === "application/vnd.apple.mpegurl" ? answer : "",
});

test("a browser that plays streams, as Safari does, plays a clip's stream", () => {
  assert.equal(pickClipAddress(ADDRESSES, describePlayer("maybe")), ADDRESSES.stream);
  assert.equal(pickClipAddress(ADDRESSES, describePlayer("probably")), ADDRESSES.stream);
});

test("a browser that doesn't play streams plays a clip's whole video", () => {
  assert.equal(pickClipAddress(ADDRESSES, describePlayer("")), ADDRESSES.video);
});

test("a clip saved before clips carried a stream plays its whole video", () => {
  assert.equal(
    pickClipAddress({ video: ADDRESSES.video }, describePlayer("maybe")),
    ADDRESSES.video,
  );
});
