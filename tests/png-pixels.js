import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const SIGNATURE_LENGTH = 8;
const RGBA = 6;
const CHANNELS = 4;

/**
 * Each chunk of a PNG file, by its type, in order.
 * @param {Buffer} file
 */
function listChunks(file) {
  const chunks = [];
  for (let offset = SIGNATURE_LENGTH; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, data: file.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  return chunks;
}

/**
 * The byte a PNG's Paeth filter predicts from the bytes left, above, and above left.
 * @param {number} left
 * @param {number} above
 * @param {number} aboveLeft
 */
function predictPaeth(left, above, aboveLeft) {
  const estimate = left + above - aboveLeft;
  const [toLeft, toAbove, toAboveLeft] = [left, above, aboveLeft].map((byte) =>
    Math.abs(estimate - byte),
  );
  if (toLeft <= toAbove && toLeft <= toAboveLeft) return left;
  return toAbove <= toAboveLeft ? above : aboveLeft;
}

/**
 * A row's bytes with its filter undone, from the row above it.
 * @param {number} filter
 * @param {Buffer} row
 * @param {Uint8Array} above
 */
function unfilterRow(filter, row, above) {
  const bytes = new Uint8Array(row.length);
  for (let index = 0; index < row.length; index++) {
    const left = index >= CHANNELS ? bytes[index - CHANNELS] : 0;
    const aboveLeft = index >= CHANNELS ? above[index - CHANNELS] : 0;
    const prediction = [
      0,
      left,
      above[index],
      Math.floor((left + above[index]) / 2),
      predictPaeth(left, above[index], aboveLeft),
    ][filter];
    bytes[index] = (row[index] + prediction) & 0xff;
  }
  return bytes;
}

/**
 * Each pixel of an 8-bit RGBA PNG, as [red, green, blue, alpha], row by row.
 * @param {URL} path
 * @returns {number[][]}
 */
export function readPngPixels(path) {
  const chunks = listChunks(readFileSync(path));
  const header = chunks[0].data;
  const width = header.readUInt32BE(0);
  const [bitDepth, colorType, , , interlace] = header.subarray(8);
  if (bitDepth !== 8 || colorType !== RGBA || interlace !== 0)
    throw new Error(`${path} isn't an 8-bit RGBA PNG without interlacing`);
  const data = inflateSync(
    Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)),
  );
  const rowLength = width * CHANNELS;
  const pixels = [];
  let above = new Uint8Array(rowLength);
  for (let offset = 0; offset < data.length; offset += rowLength + 1) {
    above = unfilterRow(data[offset], data.subarray(offset + 1, offset + 1 + rowLength), above);
    for (let index = 0; index < rowLength; index += CHANNELS)
      pixels.push([...above.subarray(index, index + CHANNELS)]);
  }
  return pixels;
}
