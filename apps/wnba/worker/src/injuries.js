import { findTeamCodeByEspnId } from "../../page/js/teams.js";
import {
  fetchInjuryReport,
  listReportedPlayers,
  nameInjuryReportRequest,
} from "../../../../shared/worker/espn-adapter.js";
import { ESPN_HEADERS } from "./wnba.js";

// Who ESPN's injury report lists as out across the league, whether she's out for the rest of the
// season, and why (shared/worker/espn-adapter.js). Only today's report exists, so only today's
// rosters say who is out.

const SPORT = "basketball/wnba";
const OUT = "Out";
const FOR_SEASON = "OFS";

export { describeOutReason } from "../../../../shared/worker/espn-adapter.js";

/**
 * @typedef {object} OutReason
 * @property {string | null} reason what's wrong, as "Left knee surgery"
 * @property {boolean} isForSeason
 * @property {string | null} sentence RotoWire's, when it says more than that she's out
 * @property {string | null} updated when ESPN last changed it, as an ISO time
 */
/** @typedef {OutReason & { name: string }} OutPlayer a player out, by her name's letters */

export const nameInjuriesRequest = () => nameInjuryReportRequest(SPORT);

/**
 * ESPN's injury report of today.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {number | null} cacheSeconds
 */
export const fetchInjuries = (fetchImpl, cacheSeconds) =>
  fetchInjuryReport(fetchImpl, SPORT, { headers: ESPN_HEADERS, cacheSeconds });

/**
 * The players ESPN lists as out, by team.
 * @param {any} report
 * @returns {Record<string, OutPlayer[]>}
 */
export function listOutPlayers(report) {
  const reported = listReportedPlayers(report, {
    findTeam: findTeamCodeByEspnId,
    isShown: (status) => status === OUT,
  });
  return Object.fromEntries(
    Object.entries(reported).map(([team, players]) => [
      team,
      players.map(({ name, reason, fantasyStatus, sentence, updated }) => ({
        name,
        reason,
        isForSeason: fantasyStatus === FOR_SEASON,
        sentence,
        updated,
      })),
    ]),
  );
}
