import { findTeamCodeByEspnId } from "../../page/js/teams.js";
import { normalizeName } from "../../page/js/player-names.js";
import { fetchUpstream } from "../../../../shared/worker/upstream.js";
import { ESPN_HEADERS } from "./wnba.js";

// ESPN's injury report lists every player out across the league in one answer: what's wrong and
// on which side, whether she's out for the rest of the season, and RotoWire's sentence on it,
// which ESPN carries with the day it last changed. Only today's report exists, so only today's
// rosters say who is out.

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";
const OUT = "Out";
const FOR_SEASON = "OFS";
// ESPN's word for a detail it doesn't know.
const NO_DETAIL = "Not Specified";
// Where ESPN's word isn't the league's.
const REASON_WORDS = { Personal: "Personal reasons" };
// A name that keeps its capital in the middle of a reason.
const PROPER_WORDS = new Set(["Achilles"]);

/**
 * @typedef {object} OutReason
 * @property {string | null} reason what's wrong, as "Left knee surgery"
 * @property {boolean} isForSeason
 * @property {string | null} sentence RotoWire's, when it says more than that she's out
 * @property {string | null} updated when ESPN last changed it, as an ISO time
 */
/** @typedef {OutReason & { name: string }} OutPlayer a player out, by her name's letters */

export const nameInjuriesRequest = () => `${ESPN_SITE}/injuries`;

/**
 * ESPN's injury report of today.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {number | null} cacheSeconds
 */
export async function fetchInjuries(fetchImpl, cacheSeconds) {
  const response = await fetchUpstream(fetchImpl, nameInjuriesRequest(), {
    headers: ESPN_HEADERS,
    cacheSeconds,
  });
  if (!response.ok) throw new Error(`ESPN answered ${response.status} for its injury report`);
  return response.json();
}

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
 * @returns {OutPlayer}
 */
const describeOutPlayer = (injury) => ({
  name: normalizeName(injury.athlete),
  reason: describeOutReason(injury.details),
  isForSeason: injury.details?.fantasyStatus?.abbreviation === FOR_SEASON,
  sentence: readSentence(injury.shortComment),
  updated: readTime(injury.date),
});

/**
 * The players ESPN lists as out, by team.
 * @param {any} report
 * @returns {Record<string, OutPlayer[]>}
 */
export function listOutPlayers(report) {
  /** @type {Record<string, OutPlayer[]>} */
  const byTeam = {};
  for (const entry of report?.injuries ?? []) {
    const team = findTeamCodeByEspnId(entry.id);
    if (!team) continue;
    byTeam[team] = (entry.injuries ?? [])
      .filter((/** @type {any} */ injury) => injury.status === OUT && injury.athlete)
      .map(describeOutPlayer);
  }
  return byTeam;
}
