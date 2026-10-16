import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { readStoryLead } from "../../../../shared/worker/story-lead.js";
import { fetchMlbJson } from "./mlb.js";

// One finished game's highlights for its sheet's Highlights section: MLB's recap video, MLB.com's
// written recap, and the clip of each play MLB cut, in the order they came, each with its inning
// and, for a play that scored, the score after it. MLB ties each play's clip to the play in its
// live feed, so the clips that are plays are the ones the feed names. The store keeps each
// game's (highlights-updater.js), so the route reads MLB only for a game the store hasn't kept.
//
// Each still shows the moment, never a headline: the recap's is a frame from its video, since
// MLB's is a title card, and a play's is MLB's unless it has a headline laid over it, as the
// store's job asks Claude (headline-stills.js), when it's a frame from the play's video, or,
// for a clip without frames, MLB.com's photo of the game.

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

const GAME_ID = /^\d{1,9}$/;
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
  const parts = String(duration ?? "")
    .split(":")
    .map(Number);
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return null;
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
  if (!frames || count === 0) return null;
  const middle = String(Math.round(count / 2)).padStart(FRAME_NUMBER_DIGITS, "0");
  return frames.replace("%", middle);
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
  /** @type {Map<string, any>} */
  const plays = new Map();
  (feed?.liveData?.plays?.allPlays ?? []).forEach((/** @type {any} */ play, order) => {
    const isTop = play.about?.halfInning === "top";
    const scored = play.about?.isScoringPlay === true;
    const facts = {
      order,
      half: isTop ? "top" : "bottom",
      inning: play.about?.inning ?? null,
      score: scored ? [play.result?.awayScore ?? 0, play.result?.homeScore ?? 0] : null,
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
const listItems = (content) => content?.highlights?.highlights?.items ?? [];

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
  return {
    id,
    recap: describeRecap(items, findStill(storyImage, RECAP_STILL_WIDTH)),
    story: describeStory(content?.editorial?.recap?.mlb),
    plays: listPlayClips(items, listPlaysById(feed), {
      withHeadlines,
      storyPhoto: findStill(storyImage, PLAY_STILL_WIDTH),
    }),
  };
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
  return { content, feed };
}

/**
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} id
 */
async function fetchHighlights(fetchImpl, id) {
  const { content, feed } = await fetchGameMedia(fetchImpl, id);
  return describeHighlights(id, content, feed);
}

export function createHighlightsServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveHighlights(url, readDoc) {
    const id = url.searchParams.get("id") ?? "";
    if (!GAME_ID.test(id))
      return respondError(400, "invalid_argument", "id must be an MLB game id");
    try {
      const kept = await readKeptDoc(readDoc, nameHighlightsKey(id));
      return respondJson(kept ?? (await fetchHighlights(fetchImpl, id)));
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read MLB: ${describeError(error)}`);
    }
  }

  return { serveHighlights };
}
