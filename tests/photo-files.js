// Stand-ins for a news photo's file: its first bytes, which say its size.

/** @param {number} value */
const writeUint32 = (value) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);

/** @param {string} text */
const writeText = (text) => [...text].map((character) => character.charCodeAt(0));

/**
 * A PNG's signature and header, which say its size.
 * @param {number} width
 * @param {number} height
 */
export const createPng = (width, height) =>
  new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...writeUint32(13),
    ...writeText("IHDR"),
    ...writeUint32(width),
    ...writeUint32(height),
  ]);
