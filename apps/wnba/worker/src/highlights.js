import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readStoryLead } from "../../../../shared/worker/story-lead.js";
import { createEspnGameReader, readGame } from "./lead.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";

// One finished game's highlights for its sheet's Highlights section, from ESPN's game summary:
// its recap video, its written recap, and the clips of the game's plays, in the order ESPN posted
// them, which follows the game. ESPN takes each clip down a while after the game, so each says
// when. The store keeps each game's (highlights-updater.js), so the route reads ESPN only for a
// game the store hasn't kept.

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

const RECAP_TITLE = /game highlights$/i;

const HIGHLIGHTS_COLLECTION = "highlights";

/** @param {string} id */
export const nameHighlightsKey = (id) => `${HIGHLIGHTS_COLLECTION}/${id}`;

/** @param {any} video */
const findVideo = (video) => video.links?.source?.HD?.href ?? video.links?.source?.href ?? null;

/**
 * A clip as the sheet shows it, or null for one without a video the phone can play.
 * @param {any} video
 */
function describeClip(video) {
  const url = findVideo(video);
  const title = String(video.headline ?? "").trim();
  if (!url || !title) return null;
  return {
    title,
    length: Number.isFinite(video.duration) ? video.duration : null,
    still: video.thumbnail ?? null,
    video: url,
    expiresAt: video.timeRestrictions?.expirationDate ?? null,
  };
}

/** @param {any} video */
const isRecap = (video) => RECAP_TITLE.test(String(video.headline ?? "").trim());

/** @param {any} video */
const readPublished = (video) => Date.parse(video.originalPublishDate) || 0;

/** @param {any[]} videos */
function describeRecap(videos) {
  const video = videos.find(isRecap);
  const clip = video && describeClip(video);
  return clip ? { ...clip, blurb: String(video.description ?? "").trim() } : null;
}

/** @param {any[]} videos */
const listPlayClips = (videos) =>
  videos
    .filter((video) => !isRecap(video))
    .sort((first, second) => readPublished(first) - readPublished(second))
    .map(describeClip)
    .filter(Boolean);

/** @param {any} article ESPN's story on the game */
function describeStory(article) {
  const title = String(article?.headline ?? "").trim();
  const lead = readStoryLead(article?.story);
  const url = article?.links?.web?.href;
  if (article?.type !== "Recap" || !title || !lead || !url) return null;
  return { title, lead, url: String(url).replace(/^http:/, "https:"), outlet: "ESPN" };
}

/**
 * @param {string} id
 * @param {any} summary ESPN's game summary
 */
export function describeHighlights(id, summary) {
  const videos = summary?.videos ?? [];
  return {
    id,
    recap: describeRecap(videos),
    story: describeStory(summary?.article),
    plays: listPlayClips(videos),
  };
}

/**
 * Reads ESPN for a game's highlights afresh, as null when ESPN has no such game that day.
 * @param {{ fetchImpl?: (input: string, init: object) => Promise<Response> }} [options]
 */
export function createHighlightsReader({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  const espnGames = createEspnGameReader({ fetchImpl });
  /** @param {{ id: string, away: string, home: string, start: string }} game */
  return async function readHighlights({ id, ...game }) {
    const summary = await espnGames.fetchSummary(game);
    return summary ? describeHighlights(id, summary) : null;
  };
}

export function createHighlightsServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  const readHighlights = createHighlightsReader({ fetchImpl });

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveHighlights(url, readDoc) {
    const game = readGame(url.searchParams);
    if (!game)
      return respondError(
        400,
        "invalid_argument",
        "id, away, home, and start must name a WNBA game",
      );
    try {
      const highlights =
        (await readKeptDoc(readDoc, nameHighlightsKey(game.id))) ?? (await readHighlights(game));
      if (!highlights) return respondError(404, "not_found", "ESPN has no such game that day");
      return respondJson(highlights);
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read ESPN: ${describeError(error)}`);
    }
  }

  return { serveHighlights };
}
