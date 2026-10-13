import { abortAfter } from "./timeout.js";

// A photo's width and height, read from the start of its file, which says them before any of the
// picture: a PNG, GIF, or WebP in its first few bytes, and a JPEG in its frame header, after any
// notes the camera or editor put first.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const JPEG_START = [0xff, 0xd8];
// The markers that start a JPEG frame header; the others in C0 to CF are tables.
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
// Markers that stand alone, without a length after them.
const isStandaloneMarker = (marker) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);

// Only the kinds of file this reads, so a server that could send AVIF sends one of these.
const PHOTO_TYPES = "image/jpeg, image/png, image/webp, image/gif";
// A JPEG's frame header follows its notes, which a camera's thumbnail can make long.
const MAX_HEADER_BYTES = 256 * 1024;
// A photo's first bytes come at once; a read this long has stalled.
const PHOTO_TIMEOUT_MS = 15e3;

/** @typedef {{ width: number, height: number }} ImageSize */

/**
 * @param {Uint8Array} bytes
 * @param {number[]} signature
 * @param {number} [at]
 */
const hasBytes = (bytes, signature, at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte);

/** @param {Uint8Array} bytes @param {number} at */
const readUint16 = (bytes, at) => (bytes[at] << 8) | bytes[at + 1];

/** @param {Uint8Array} bytes @param {number} at */
const readUint16Little = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);

/** @param {Uint8Array} bytes @param {number} at */
const readUint24Little = (bytes, at) => readUint16Little(bytes, at) | (bytes[at + 2] << 16);

/** @param {Uint8Array} bytes @param {number} at */
const readUint32 = (bytes, at) => readUint16(bytes, at) * 0x10000 + readUint16(bytes, at + 2);

/** @param {Uint8Array} bytes @returns {ImageSize | null} */
function readPngSize(bytes) {
  if (bytes.length < 24) return null;
  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
}

/** @param {Uint8Array} bytes @returns {ImageSize | null} */
function readGifSize(bytes) {
  if (bytes.length < 10) return null;
  return { width: readUint16Little(bytes, 6), height: readUint16Little(bytes, 8) };
}

/**
 * A WebP's size, from its first chunk: a lossy picture's, a lossless one's, or the extended header's.
 * @param {Uint8Array} bytes
 * @returns {ImageSize | null}
 */
function readWebpSize(bytes) {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8 ")
    return {
      width: readUint16Little(bytes, 26) & 0x3fff,
      height: readUint16Little(bytes, 28) & 0x3fff,
    };
  if (chunk === "VP8L") {
    const bits = readUint16Little(bytes, 21) | (readUint16Little(bytes, 23) << 16);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X")
    return { width: readUint24Little(bytes, 24) + 1, height: readUint24Little(bytes, 27) + 1 };
  return null;
}

/**
 * A JPEG's size, from its frame header, stepping over each segment before it by its length.
 * @param {Uint8Array} bytes
 * @returns {ImageSize | null}
 */
function readJpegSize(bytes) {
  let at = JPEG_START.length;
  while (at + 9 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) at += 1;
    else if (JPEG_FRAME_MARKERS.has(marker))
      return { height: readUint16(bytes, at + 5), width: readUint16(bytes, at + 7) };
    else if (isStandaloneMarker(marker)) at += 2;
    else at += 2 + readUint16(bytes, at + 2);
  }
  return null;
}

/**
 * The size the start of a photo's file says, or null when it hasn't said it yet or isn't a kind
 * this reads.
 * @param {Uint8Array} bytes
 * @returns {ImageSize | null}
 */
export function readImageSize(bytes) {
  if (hasBytes(bytes, PNG_SIGNATURE)) return readPngSize(bytes);
  if (hasBytes(bytes, GIF_SIGNATURE)) return readGifSize(bytes);
  if (hasBytes(bytes, RIFF) && hasBytes(bytes, WEBP, 8)) return readWebpSize(bytes);
  if (hasBytes(bytes, JPEG_START)) return readJpegSize(bytes);
  return null;
}

/** @param {Uint8Array} first @param {Uint8Array} second */
function joinBytes(first, second) {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}

/**
 * Reads the photo only until its size shows, then stops.
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @returns {Promise<ImageSize | null>}
 */
async function readSizeFromStream(reader) {
  let bytes = new Uint8Array(0);
  while (bytes.length < MAX_HEADER_BYTES) {
    const { done, value } = await reader.read();
    if (done) return null;
    bytes = joinBytes(bytes, value);
    const size = readImageSize(bytes);
    if (size) return size;
  }
  return null;
}

/**
 * The photo's size, from the start of its file.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @returns {Promise<ImageSize>}
 */
export const readPhotoSize = (fetchImpl, url) =>
  abortAfter(PHOTO_TIMEOUT_MS, async (signal) => {
    const response = await fetchImpl(url, { headers: { accept: PHOTO_TYPES }, signal });
    if (!response.ok || !response.body) throw new Error(`The photo answered ${response.status}`);
    const reader = response.body.getReader();
    try {
      const size = await readSizeFromStream(reader);
      if (!size?.width || !size.height) throw new Error("The photo's file doesn't say its size");
      return size;
    } finally {
      await reader.cancel().catch(() => {});
    }
  });
