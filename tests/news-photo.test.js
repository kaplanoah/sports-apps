import test from "node:test";
import assert from "node:assert/strict";
import { chooseFrameTop, framePhoto, WIDEST_FRAME } from "../shared/page/news-photo.js";

const URL = "https://example.com/photo.jpg";

/** @param {number} width @param {number} height @param {number} [frameTop] */
const createPhoto = (width, height, frameTop) => ({
  url: URL,
  credit: "",
  width,
  height,
  ...(frameTop !== undefined && { frameTop }),
});

/** @param {{ aspect: number, position: number }} frame */
const roundFrame = ({ aspect, position }) => ({
  aspect: Math.round(aspect * 1000) / 1000,
  position: Math.round(position * 10) / 10,
});

test("a photo from 16:9 to 3:2 shows whole, in its own shape", () => {
  assert.deepEqual(framePhoto(createPhoto(1920, 1080)), { aspect: WIDEST_FRAME, position: 50 });
  assert.deepEqual(framePhoto(createPhoto(1600, 1000)), { aspect: 1.6, position: 50 });
  assert.deepEqual(framePhoto(createPhoto(1800, 1200)), { aspect: 1.5, position: 50 });
});

test("a photo wider than 16:9 loses its sides, and one a hair taller than 3:2 a sliver", () => {
  assert.deepEqual(framePhoto(createPhoto(2560, 1080)), { aspect: WIDEST_FRAME, position: 50 });
  assert.deepEqual(framePhoto(createPhoto(1024, 683)), { aspect: 1.5, position: 50 });
});

test("a taller photo is cut to 3:2 where Claude placed the frame", () => {
  // The frame shows 683 / 1024 / 1.5 of its height, so it can move down 0.555 of it.
  assert.deepEqual(roundFrame(framePhoto(createPhoto(683, 1024, 0.128))), {
    aspect: 1.5,
    position: 23,
  });
});

test("where Claude hasn't said, a taller photo's frame sits with its middle 22% of the photo's height above the photo's", () => {
  // Its middle at 0.28 of the height, so its top at 0.28 - 0.222.
  assert.deepEqual(roundFrame(framePhoto(createPhoto(683, 1024))), {
    aspect: 1.5,
    position: 10.4,
  });
  assert.deepEqual(framePhoto(createPhoto(600, 600)), { aspect: 1.5, position: 0 });
});

test("a photo the Worker hasn't sized yet shows 16:9 from its top", () => {
  assert.deepEqual(framePhoto({ url: URL, credit: "" }), { aspect: WIDEST_FRAME, position: 0 });
});

test("the frame centers a subject that fits it, and starts at the top of one that doesn't", () => {
  const tall = { width: 683, height: 1024 };
  const share = 683 / 1024 / 1.5;

  assert.equal(chooseFrameTop(tall, 0.3, 0.5), 0.4 - share / 2);
  assert.equal(chooseFrameTop(tall, 0.15, 0.9), 0.15);
  assert.equal(chooseFrameTop(tall, 0, 0.1), 0);
  assert.equal(chooseFrameTop(tall, 0.85, 1), 1 - share);
});
