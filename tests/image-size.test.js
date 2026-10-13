import test from "node:test";
import assert from "node:assert/strict";
import { readImageSize, readPhotoSize } from "../shared/worker/image-size.js";
import { createPng } from "./photo-files.js";

/** @param {number} value */
const writeUint16 = (value) => [(value >> 8) & 0xff, value & 0xff];

/** @param {number} value */
const writeUint16Little = (value) => [value & 0xff, (value >> 8) & 0xff];

/** @param {number} value */
const writeUint24Little = (value) => [...writeUint16Little(value), (value >> 16) & 0xff];

/** @param {string} text */
const writeText = (text) => [...text].map((character) => character.charCodeAt(0));

/**
 * A JPEG's start, with a camera's note and a table before its frame header, as cameras write them.
 * @param {number} width
 * @param {number} height
 */
const createJpeg = (width, height) =>
  new Uint8Array([
    ...[0xff, 0xd8],
    ...[0xff, 0xe1, ...writeUint16(8), ...writeText("Exif"), 0, 0],
    ...[0xff, 0xdb, ...writeUint16(4), 0, 0],
    ...[0xff, 0xc2, ...writeUint16(11), 8, ...writeUint16(height), ...writeUint16(width), 3],
    ...new Array(16).fill(0),
  ]);

/** @param {number} width @param {number} height */
const createGif = (width, height) =>
  new Uint8Array([
    ...writeText("GIF89a"),
    ...writeUint16Little(width),
    ...writeUint16Little(height),
  ]);

/**
 * @param {string} chunk
 * @param {number[]} data the chunk's first bytes
 */
const createWebp = (chunk, data) =>
  new Uint8Array([
    ...writeText("RIFF"),
    0,
    0,
    0,
    0,
    ...writeText("WEBP"),
    ...writeText(chunk),
    0,
    0,
    0,
    0,
    ...data,
    ...new Array(16).fill(0),
  ]);

test("a JPEG says its size in its frame header, after whatever comes before it", () => {
  assert.deepEqual(readImageSize(createJpeg(683, 1024)), { width: 683, height: 1024 });
});

test("a PNG and a GIF say their size in their first bytes", () => {
  assert.deepEqual(readImageSize(createPng(2000, 1333)), { width: 2000, height: 1333 });
  assert.deepEqual(readImageSize(createGif(600, 400)), { width: 600, height: 400 });
});

test("a WebP says its size in its first chunk, lossy, lossless, or extended", () => {
  const lossy = createWebp("VP8 ", [
    ...[0, 0, 0, 0x9d, 0x01, 0x2a],
    ...writeUint16Little(1600),
    ...writeUint16Little(900),
  ]);
  const bits = (1200 - 1) | ((800 - 1) << 14);
  const lossless = createWebp("VP8L", [
    0x2f,
    ...writeUint16Little(bits),
    ...writeUint16Little(bits >>> 16),
  ]);
  const extended = createWebp("VP8X", [
    0,
    0,
    0,
    0,
    ...writeUint24Little(1919),
    ...writeUint24Little(1079),
  ]);

  assert.deepEqual(readImageSize(lossy), { width: 1600, height: 900 });
  assert.deepEqual(readImageSize(lossless), { width: 1200, height: 800 });
  assert.deepEqual(readImageSize(extended), { width: 1920, height: 1080 });
});

test("a file cut before its size, or of a kind this doesn't read, says no size", () => {
  assert.equal(readImageSize(createJpeg(683, 1024).subarray(0, 24)), null);
  assert.equal(readImageSize(createPng(10, 10).subarray(0, 20)), null);
  assert.equal(readImageSize(new TextEncoder().encode("<html>Not found</html>")), null);
});

/**
 * A photo's file sent a few bytes at a time, counting the pieces read before the reader stopped.
 * @param {Uint8Array} bytes
 */
function createSlowPhoto(bytes) {
  const sent = { pieces: 0, cancelled: false };
  let at = 0;
  // A high-water mark of 0 sends each piece only when it's asked for.
  const body = new ReadableStream(
    {
      pull(controller) {
        if (at >= bytes.length) return controller.close();
        sent.pieces += 1;
        controller.enqueue(bytes.slice(at, at + 8));
        at += 8;
      },
      cancel() {
        sent.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { sent, response: new Response(body) };
}

test("a photo is read only until its size shows, asking for only the kinds this reads", async () => {
  const bytes = new Uint8Array([...createPng(683, 1024), ...new Array(4096).fill(0)]);
  const { sent, response } = createSlowPhoto(bytes);
  const requests = [];

  const size = await readPhotoSize(async (url, init) => {
    requests.push({ url, init });
    return response;
  }, "https://example.com/photo.jpg");

  assert.deepEqual(size, { width: 683, height: 1024 });
  assert.equal(sent.pieces, 3);
  assert.equal(sent.cancelled, true);
  assert.equal(requests[0].url, "https://example.com/photo.jpg");
  assert.equal(requests[0].init.headers.accept, "image/jpeg, image/png, image/webp, image/gif");
});

test("a photo that doesn't answer, or whose file doesn't say its size, fails", async () => {
  await assert.rejects(
    readPhotoSize(async () => new Response("gone", { status: 404 }), "https://example.com/a.jpg"),
    /The photo answered 404/,
  );
  await assert.rejects(
    readPhotoSize(async () => new Response("<html></html>"), "https://example.com/b.jpg"),
    /doesn't say its size/,
  );
});
