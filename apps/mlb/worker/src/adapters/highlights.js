import {
  BaseballHighlights,
  validateSportsData,
} from "../../../../../shared/worker/sports-schema.js";
import { readStoryLead } from "../../../../../shared/worker/story-lead.js";
import { fetchMlbJson } from "../mlb.js";

const CONTENT_CACHE_SECONDS = 60;
const PLAY_FIELDS = [
  "liveData",
  "plays",
  "allPlays",
  "about",
  "inning",
  "halfInning",
  "isScoringPlay",
  "result",
  "awayScore",
  "homeScore",
  "playEvents",
  "playId",
].join(",");
// The recap fills the section's width and a play's still a column beside its title, so each
// takes the smallest of MLB's cuts that stays sharp on a phone.
const RECAP_STILL_WIDTH = 960;
const PLAY_STILL_WIDTH = 480;
const RECAP_TAG = "game-recap";
const VIDEO_PLAYBACK = "mp4Avc";
// MLB's frames from a clip's video, one at the end of each five seconds, numbered from 1 in seven
// digits in place of the address's "%".
const FRAMES_PLAYBACK = "trickplay";
const FRAME_SECONDS = 5;
const FRAME_NUMBER_DIGITS = 7;
// Getty's and the AP's photos, named for their agency, never carry a headline.
const NEWS_PHOTO = /^(GettyImages|AP\d)/;

const HIGHLIGHTS_COLLECTION = "highlights";

/** @param {string} id */
export const nameHighlightsKey = (id) => `${HIGHLIGHTS_COLLECTION}/${id}`;

/** @param {string} id */
export const nameContentRequest = (id) => `/api/v1/game/${id}/content`;

/** @param {string} id */
export const namePlaysRequest = (id) => `/api/v1.1/game/${id}/feed/live?fields=${PLAY_FIELDS}`;

/**
 * Seconds from MLB's "00:03:01".
 * @param {string | undefined} duration
 */
function readSeconds(duration) {
  if (duration == null || duration === "") return null;
  const parts = String(duration ?? "")
    .split(":")
    .map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * @param {any} image
 * @param {number} width
 */
function findStill(image, width) {
  const cuts = (image?.cuts ?? [])
    .filter((/** @type {any} */ cut) => cut.src && cut.width)
    .sort((/** @type {any} */ first, /** @type {any} */ second) => first.width - second.width);
  return (cuts.find((/** @type {any} */ cut) => cut.width >= width) ?? cuts.at(-1))?.src ?? null;
}

/**
 * The frame nearest the middle of a clip's video.
 * @param {any} item
 */
function findFrame(item) {
  const frames = item.playbacks?.find(
    (/** @type {any} */ playback) => playback.name === FRAMES_PLAYBACK,
  )?.url;
  const count = Math.floor((readSeconds(item.duration) ?? 0) / FRAME_SECONDS);
  if (typeof frames !== "string" || count === 0) return null;
  const middle = String(Math.round(count / 2)).padStart(FRAME_NUMBER_DIGITS, "0");
  // Only the frame filename's token is a placeholder; URL escapes elsewhere stay intact.
  const filled = frames.replace(/%(?=\.jpg(?:[?#]|$))/g, middle);
  return filled === frames ? null : filled;
}

/** @param {any} item */
const isNewsPhoto = (item) => NEWS_PHOTO.test(String(item.image?.title ?? ""));

/** @param {any} item */
const findVideo = (item) =>
  item.playbacks?.find((/** @type {any} */ playback) => playback.name === VIDEO_PLAYBACK)?.url ??
  null;

/**
 * A clip as the sheet shows it, or null for one without a video the phone can play.
 * @param {any} item
 * @param {string | null} still
 */
function describeClip(item, still) {
  const video = findVideo(item);
  const title = String(item.headline ?? "").trim();
  if (!video || !title) return null;
  return { title, length: readSeconds(item.duration), still, video };
}

/** @param {any} item */
const isRecap = (item) =>
  (item.keywordsAll ?? []).some(
    (/** @type {any} */ keyword) => keyword.type === "taxonomy" && keyword.value === RECAP_TAG,
  );

/**
 * Each play's place in the game by the ids of its pitches and actions, which a clip names.
 * @param {any} feed
 */
function listPlaysById(feed) {
  if (!Array.isArray(feed?.liveData?.plays?.allPlays)) throw new Error("Invalid sports plays");
  /** @type {Map<string, any>} */
  const plays = new Map();
  (feed?.liveData?.plays?.allPlays ?? []).forEach((/** @type {any} */ play, order) => {
    const isTop = play.about?.halfInning === "top";
    const scored = play.about?.isScoringPlay === true;
    const facts = {
      order,
      half: play.about?.halfInning,
      inning: play.about?.inning ?? null,
      score: scored ? [play.result?.awayScore, play.result?.homeScore] : null,
      scorer: scored ? (isTop ? "away" : "home") : null,
    };
    for (const event of play.playEvents ?? []) if (event.playId) plays.set(event.playId, facts);
  });
  return plays;
}

/**
 * The clips of the game's plays, once each, in the order the plays came, each with its play.
 * @param {any[]} items
 * @param {Map<string, any>} plays
 */
function listPlayItems(items, plays) {
  const found = new Map();
  for (const item of items) {
    const play = plays.get(item.guid);
    if (play && describeClip(item, null) && !found.has(item.guid))
      found.set(item.guid, { item, play });
  }
  return [...found.values()].sort((first, second) => first.play.order - second.play.order);
}

/** @param {any} content MLB's content for the game */
function listItems(content) {
  const items = content?.highlights?.highlights?.items;
  if (!Array.isArray(items)) throw new Error("Invalid sports highlights");
  return items;
}

/** @param {any} content MLB's content for the game */
const findStoryImage = (content) => content?.editorial?.recap?.mlb?.image;

/**
 * MLB's still of each play's clip that may have a headline on it, for the store's job to check.
 * @param {any} content MLB's content for the game
 * @param {any} feed the game's plays from its live feed, trimmed to PLAY_FIELDS
 */
export const listStillsToCheck = (content, feed) =>
  listPlayItems(listItems(content), listPlaysById(feed))
    .filter(({ item }) => !isNewsPhoto(item))
    .map(({ item }) => findStill(item.image, PLAY_STILL_WIDTH))
    .filter((still) => still !== null);

/**
 * @typedef {object} PlayStills
 * @property {Set<string>} withHeadlines MLB's stills the store's job found a headline on
 * @property {string | null} storyPhoto MLB.com's photo of the game
 */

/**
 * @param {any} item
 * @param {PlayStills} stills
 */
function choosePlayStill(item, { withHeadlines, storyPhoto }) {
  const still = findStill(item.image, PLAY_STILL_WIDTH);
  if (!still || !withHeadlines.has(still)) return still;
  return findFrame(item) ?? storyPhoto ?? still;
}

/**
 * @param {any[]} items
 * @param {Map<string, any>} plays
 * @param {PlayStills} stills
 */
const listPlayClips = (items, plays, stills) =>
  listPlayItems(items, plays).map(({ item, play: { order, ...facts } }) => ({
    ...describeClip(item, choosePlayStill(item, stills)),
    ...facts,
  }));

/** @param {any} recap MLB.com's recap story */
function describeStory(recap) {
  const title = String(recap?.headline ?? "").trim();
  const lead = readStoryLead(recap?.body);
  if (!title || !recap?.slug || !lead) return null;
  return { title, lead, url: `https://www.mlb.com/news/${recap.slug}`, outlet: "MLB.com" };
}

/**
 * @param {any[]} items
 * @param {string | null} storyPhoto
 */
function describeRecap(items, storyPhoto) {
  const item = items.find(isRecap);
  if (!item) return null;
  const still = findFrame(item) ?? storyPhoto ?? findStill(item.image, RECAP_STILL_WIDTH);
  const clip = describeClip(item, still);
  return clip ? { ...clip, blurb: String(item.description ?? "").trim() } : null;
}

/**
 * @param {string} id
 * @param {any} content MLB's content for the game
 * @param {any} feed the game's plays from its live feed, trimmed to PLAY_FIELDS
 * @param {Set<string>} [withHeadlines] MLB's stills the store's job found a headline on
 */
export function describeHighlights(id, content, feed, withHeadlines = new Set()) {
  const items = listItems(content);
  const storyImage = findStoryImage(content);
  return validateSportsData(BaseballHighlights, {
    id,
    recap: describeRecap(items, findStill(storyImage, RECAP_STILL_WIDTH)),
    story: describeStory(content?.editorial?.recap?.mlb),
    plays: listPlayClips(items, listPlaysById(feed), {
      withHeadlines,
      storyPhoto: findStill(storyImage, PLAY_STILL_WIDTH),
    }),
  });
}

/**
 * MLB's content and plays for one game, read afresh.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} id
 */
export async function fetchGameMedia(fetchImpl, id) {
  const [content, feed] = await Promise.all([
    fetchMlbJson(fetchImpl, nameContentRequest(id), CONTENT_CACHE_SECONDS),
    fetchMlbJson(fetchImpl, namePlaysRequest(id), CONTENT_CACHE_SECONDS),
  ]);
  describeHighlights(id, content, feed);
  return { content, feed };
}

/**
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} id
 */
export async function fetchHighlights(fetchImpl, id) {
  const { content, feed } = await fetchGameMedia(fetchImpl, id);
  return describeHighlights(id, content, feed);
}
