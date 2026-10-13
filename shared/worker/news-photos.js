import { chooseFrameTop, isTallerThanFrame } from "../page/news-photo.js";
import { requestClaude } from "./claude.js";
import { hashText } from "./hash-text.js";
import { readPhotoSize } from "./image-size.js";
import { describeError } from "./responses.js";

// Framing the photos the news cards show: each photo's size, read once from the start of its file,
// so a card draws its frame before the photo arrives, and, for a photo taller than the frame, where
// Claude says its subject is, asked once. A photo whose size or subject a run couldn't read is tried
// again on the next runs, a few times at most. Each is kept under a hash of its address, so a photo
// several stories share is read once, until no card shows it.

export const PHOTO_MODEL = "claude-haiku-5-5";
const MAX_ANSWER_TOKENS = 1024;
// One picture and a two-number answer; a call this long has stalled.
const CLAUDE_TIMEOUT_MS = 30e3;
// The newest cards' photos come first, so a run after a long gap still frames what's on top.
const PHOTOS_PER_RUN = 24;
const MAX_TRIES = 3;
const KEY_PREFIX = "photo:";
const PROMPT = `You frame news photos for a sports app, which shows each photo in a wide frame that cuts off some of its top and bottom. Find the photo's subject: the people the photo is about, from the top of the highest head to the bottom of what matters most, like the ball in play or a player's hands, leaving out the crowd, the floor, and anyone at the edges.

Answer with subjectTop and subjectBottom, each a percentage of the photo's height down from its top edge, from 0 at the top to 100 at the bottom.`;
export const PHOTO_SPOT_SCHEMA = {
  type: "object",
  properties: {
    subjectTop: { type: "integer" },
    subjectBottom: { type: "integer" },
  },
  required: ["subjectTop", "subjectBottom"],
  additionalProperties: false,
};

/**
 * What the store keeps for a photo: its address, its size once read, where its frame starts once
 * Claude said, and how many runs failed to read either.
 * @typedef {{ url: string, width?: number, height?: number, frameTop?: number, tries?: number }} PhotoFrame
 */

/** @param {number} percent */
const readShare = (percent) => Math.min(1, Math.max(0, percent / 100));

/**
 * Where the frame starts on a tall photo, as Claude places its subject.
 * @param {{ apiKey: string, fetchImpl: typeof fetch }} options
 * @param {string} url
 * @param {{ width: number, height: number }} size
 */
async function askFrameTop({ apiKey, fetchImpl }, url, size) {
  const { answer } = await requestClaude({
    apiKey,
    fetchImpl,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    schema: PHOTO_SPOT_SCHEMA,
    request: {
      model: PHOTO_MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      output_config: { effort: "low" },
      system: PROMPT,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url } }] }],
    },
  });
  const ends = [readShare(answer.subjectTop), readShare(answer.subjectBottom)];
  const frameTop = chooseFrameTop(size, Math.min(...ends), Math.max(...ends));
  return Math.round(frameTop * 1000) / 1000;
}

/**
 * @param {PhotoFrame} frame
 * @returns {frame is PhotoFrame & { width: number, height: number }}
 */
const hasSize = (frame) => Boolean(frame.width && frame.height);

/**
 * Whether Claude has yet to say where the frame starts on a photo taller than it.
 * @param {PhotoFrame} frame
 * @returns {frame is PhotoFrame & { width: number, height: number }}
 */
const needsSpot = (frame) =>
  hasSize(frame) && isTallerThanFrame(frame) && frame.frameTop === undefined;

/**
 * @param {PhotoFrame | undefined} frame
 * @param {boolean} canAsk whether the Worker has Claude's API key
 */
const isWaiting = (frame, canAsk) =>
  !frame || ((frame.tries ?? 0) < MAX_TRIES && (!hasSize(frame) || (canAsk && needsSpot(frame))));

/**
 * The photo's frame with what this run could add to it, or with one more try when it failed.
 * @param {{ apiKey?: string, fetchImpl: typeof fetch }} options
 * @param {string} url
 * @param {PhotoFrame} kept
 * @returns {Promise<{ frame: PhotoFrame, failed: boolean }>}
 */
async function readFrame({ apiKey, fetchImpl }, url, kept) {
  let frame = kept;
  try {
    if (!hasSize(frame)) frame = { ...frame, ...(await readPhotoSize(fetchImpl, url)) };
    if (apiKey && needsSpot(frame))
      frame = { ...frame, frameTop: await askFrameTop({ apiKey, fetchImpl }, url, frame) };
    return { frame, failed: false };
  } catch (error) {
    console.error(`Framing the photo ${url} failed: ${describeError(error)}`);
    return { frame: { ...frame, tries: (frame.tries ?? 0) + 1 }, failed: true };
  }
}

/**
 * The photos the store keeps, by their address.
 * @param {import("./season-store.js").JobContext["storage"]} storage
 * @returns {Promise<Map<string, { key: string, frame: PhotoFrame }>>}
 */
async function readKeptFrames(storage) {
  const stored = await storage.list(KEY_PREFIX);
  return new Map([...stored].map(([key, frame]) => [frame.url, { key, frame }]));
}

/**
 * Frames the photos the cards show, newest card's first, forgets the ones no card shows, and says
 * how this run went.
 * @param {{ storage: import("./season-store.js").JobContext["storage"], env: Record<string, string | undefined>, fetchImpl: typeof fetch }} context
 * @param {string[]} urls the cards' photos, newest card's first
 * @returns {Promise<{ frames: Map<string, PhotoFrame>, framed: number, failed: number }>}
 */
export async function frameNewsPhotos({ storage, env, fetchImpl }, urls) {
  const apiKey = env.ANTHROPIC_API_KEY;
  const kept = await readKeptFrames(storage);
  for (const [url, { key }] of kept) if (!urls.includes(url)) await storage.delete(key);
  const frames = new Map(
    urls.flatMap((url) => {
      const frame = kept.get(url)?.frame;
      return frame ? [[url, frame]] : [];
    }),
  );
  const waiting = urls
    .filter((url) => isWaiting(frames.get(url), Boolean(apiKey)))
    .slice(0, PHOTOS_PER_RUN);
  const read = await Promise.all(
    waiting.map((url) => readFrame({ apiKey, fetchImpl }, url, frames.get(url) ?? { url })),
  );
  for (const { frame } of read) {
    frames.set(frame.url, frame);
    await storage.put(`${KEY_PREFIX}${await hashText(frame.url)}`, frame);
  }
  const failed = read.filter((result) => result.failed).length;
  return { frames, framed: read.length - failed, failed };
}
