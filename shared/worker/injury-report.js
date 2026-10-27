import { fetchUpstream, readFeedJson } from "./upstream.js";

// ESPN's injury report for a league lists every player hurt or away across it in one answer:
// what's wrong and on which side, the league's status for it, and RotoWire's sentence on it, which
// ESPN carries with the day it last changed. Only today's report exists. Each league hands it how
// to read ESPN's team ids and which statuses it shows, and matches the players to its own by their
// names' letters, since ESPN and a league spell a name alike but for the odd accent or punctuation.

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";
// ESPN answers any caller, so it needs only to be asked for JSON.
const JSON_HEADERS = { accept: "application/json" };
// ESPN's word for a detail it doesn't know.
const NO_DETAIL = "Not Specified";
// Where ESPN's word isn't the league's.
const REASON_WORDS = { Personal: "Personal reasons" };
// A name that keeps its capital in the middle of a reason.
const PROPER_WORDS = new Set(["Achilles"]);

/**
 * Why a player is out, as one of ESPN's reports lists him.
 * @typedef {object} ReportedPlayer
 * @property {string} name his name's letters, as readNameLetters writes them
 * @property {string} status the league's status for him in ESPN's words, as "15-Day-IL" or "Out"
 * @property {string | null} reason what's wrong, as "Left knee surgery"
 * @property {string | null} fantasyStatus ESPN's short status, as "OFS" for out for the season
 * @property {string | null} sentence RotoWire's, when it says more than that he's out
 * @property {string | null} updated when ESPN last changed it, as an ISO time
 */

/**
 * The address of a league's report.
 * @param {string} sport ESPN's sport and league, as "basketball/wnba"
 */
export const nameInjuryReportRequest = (sport) => `${ESPN_SITE}/${sport}/injuries`;

/**
 * A league's report of today.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} sport
 * @param {{ headers?: Record<string, string>, cacheSeconds?: number | null }} [options]
 */
export async function fetchInjuryReport(
  fetchImpl,
  sport,
  { headers = JSON_HEADERS, cacheSeconds = null } = {},
) {
  const response = await fetchUpstream(fetchImpl, nameInjuryReportRequest(sport), {
    headers,
    cacheSeconds,
  });
  if (!response.ok) throw new Error(`ESPN answered ${response.status} for its injury report`);
  return readFeedJson(response, { feed: "ESPN", path: "its injury report" });
}

/**
 * A name's letters alone, in lowercase, to match one player across two spellings of his name.
 * @param {string} name
 */
export const readNameLetters = (name) =>
  name
    .normalize("NFD")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();

// A word in capitals, like ACL, or a name keeps its capitals; any other drops its first.
/** @param {string} word */
const lowerWord = (word) =>
  PROPER_WORDS.has(word) || word === word.toUpperCase() ? word : word.toLowerCase();

/**
 * What's wrong, in a phrase that reads on its own: the side, what's hurt, and what's wrong with it,
 * as "Left knee surgery", or null when ESPN doesn't say.
 * @param {{ type?: string, side?: string, detail?: string } | undefined} details
 */
export function describeOutReason({ type, side, detail } = {}) {
  if (!type) return null;
  const words = [side, REASON_WORDS[/** @type {"Personal"} */ (type)] ?? type, detail]
    .filter((part) => part && part !== NO_DETAIL)
    .join(" ")
    .split(" ");
  return [words[0], ...words.slice(1).map(lowerWord)].join(" ");
}

// RotoWire's sentence for a player it knows nothing more about is the one word.
/** @param {unknown} comment */
function readSentence(comment) {
  const sentence = typeof comment === "string" ? comment.trim() : "";
  return sentence && sentence.toLowerCase() !== "out" ? sentence : null;
}

/** @param {unknown} date */
function readTime(date) {
  const time = Date.parse(String(date ?? ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * @param {any} injury one of a team's injuries in ESPN's report
 * @returns {ReportedPlayer}
 */
const describeReportedPlayer = (injury) => ({
  name: readNameLetters(`${injury.athlete.firstName ?? ""} ${injury.athlete.lastName ?? ""}`),
  status: String(injury.status ?? ""),
  reason: describeOutReason(injury.details),
  fantasyStatus: injury.details?.fantasyStatus?.abbreviation ?? null,
  sentence: readSentence(injury.shortComment),
  updated: readTime(injury.date),
});

/**
 * The players a report lists with a status the league shows, by the league's own team codes,
 * leaving out a team the league doesn't know.
 * @param {any} report
 * @param {{ findTeam: (espnId: string) => string | null, isShown: (status: string) => boolean }} league
 * @returns {Record<string, ReportedPlayer[]>}
 */
export function listReportedPlayers(report, { findTeam, isShown }) {
  /** @type {Record<string, ReportedPlayer[]>} */
  const byTeam = {};
  for (const entry of report?.injuries ?? []) {
    const team = findTeam(String(entry.id));
    if (!team) continue;
    byTeam[team] = (entry.injuries ?? [])
      .filter((/** @type {any} */ injury) => injury.athlete && isShown(String(injury.status)))
      .map(describeReportedPlayer);
  }
  return byTeam;
}
