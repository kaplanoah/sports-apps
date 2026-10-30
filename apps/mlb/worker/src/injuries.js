import { findClubByEspnId } from "../../page/js/teams.js";
import {
  fetchInjuryReport,
  listReportedPlayers,
  nameInjuryReportRequest,
  readNameLetters,
} from "../../../../shared/worker/espn-adapter.js";

// Why each player on the injured list is there, from ESPN's injury report for all of MLB
// (shared/worker/espn-adapter.js). MLB's own roster says who is on the list, so the report is
// kept for every player it names, whatever its status, and a player's sheet shows it only while
// MLB lists him.

const SPORT = "baseball/mlb";

/**
 * Why a player is out, as his sheet shows it.
 * @typedef {{ reason: string | null, sentence: string | null, updated: string | null }} OutReason
 */
/** @typedef {OutReason & { club: string, name: string }} InjuredPlayer */

export const nameInjuriesRequest = () => nameInjuryReportRequest(SPORT);

/**
 * ESPN's injury report of today.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 */
export const fetchInjuries = (fetchImpl) => fetchInjuryReport(fetchImpl, SPORT);

/**
 * Every player the report names, by club and name, kept to what a sheet shows.
 * @param {any} report
 * @returns {InjuredPlayer[]}
 */
export function listInjuredPlayers(report) {
  const byClub = listReportedPlayers(report, { findTeam: findClubByEspnId, isShown: () => true });
  return Object.entries(byClub).flatMap(([club, players]) =>
    players.map(({ name, reason, sentence, updated }) => ({
      club,
      name,
      reason,
      sentence,
      updated,
    })),
  );
}

/**
 * @param {string} club
 * @param {string} name as MLB writes it
 */
export const nameInjuredKey = (club, name) => `${club}:${readNameLetters(name)}`;

/**
 * Why each player the report names is out, by nameInjuredKey.
 * @param {InjuredPlayer[]} players
 * @returns {Map<string, OutReason>}
 */
export const indexInjuredPlayers = (players) =>
  new Map(
    players.map(({ club, name, reason, sentence, updated }) => [
      `${club}:${name}`,
      { reason, sentence, updated },
    ]),
  );
