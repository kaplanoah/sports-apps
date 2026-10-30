import {
  BaseballRoster,
  BaseballPlayer,
  validateSportsData,
} from "../../../../shared/worker/sports-schema.js";
import { readLeagueRows } from "./adapters/pitchers.js";

// Each club's roster for its sheet's Roster section: its active players and who is on the injured
// list, from its 40-man roster, each with his regular season so far, from every player's numbers.
// The store keeps each club's (roster-updater.js), so the page reads only the store.

const ROSTER_FIELDS = [
  "roster",
  "person",
  "id",
  "fullName",
  "jerseyNumber",
  "position",
  "abbreviation",
  "status",
  "description",
].join(",");
// What a roster's rows show, what its club's leaders add, and what a player's sheet shows beside
// them.
const ROW_HITTING_COLUMNS = ["plateAppearances", "avg", "homeRuns", "rbi", "ops"];
const HITTING_COLUMNS = [...ROW_HITTING_COLUMNS, "stolenBases"];
const PLAYER_HITTING_COLUMNS = [
  ...ROW_HITTING_COLUMNS,
  "gamesPlayed",
  "atBats",
  "hits",
  "runs",
  "baseOnBalls",
  "strikeOuts",
  "obp",
  "slg",
  "stolenBases",
];
const PITCHING_COLUMNS = [
  "gamesPlayed",
  "gamesStarted",
  "era",
  "wins",
  "losses",
  "inningsPitched",
  "strikeOuts",
  "saves",
];
const PLAYER_PITCHING_COLUMNS = [...PITCHING_COLUMNS, "baseOnBalls"];
const LEAGUE_TABLE_FIELDS = ["stats", "splits", "player", "id", "stat"];
const ACTIVE = "Active";
// MLB's word for a stay on the injured list, as in "Injured 15-Day".
const INJURED = /^Injured\b/;

// Where the store keeps each club's roster.
const ROSTERS_COLLECTION = "rosters";

/** @param {string} club */
export const nameRosterKey = (club) => `${ROSTERS_COLLECTION}/${club}`;

/**
 * A club's 40-man roster, with each player's status.
 * @param {number} mlbTeamId
 * @param {number} season
 */
export const listRosterRequest = (mlbTeamId, season) =>
  `/api/v1/teams/${mlbTeamId}/roster?rosterType=40Man&season=${season}&fields=${ROSTER_FIELDS}`;

/**
 * Every player's season so far, at the plate or on the mound, in the regular season (R) or the
 * postseason (P), or only the hitters MLB ranks, who have had 3.1 plate appearances per team game.
 * @param {number} season
 * @param {"hitting" | "pitching"} group
 * @param {{ gameType?: "R" | "P", pool?: "all" | "qualified" }} [options]
 */
export function listSeasonStatsRequest(season, group, { gameType = "R", pool = "all" } = {}) {
  const columns = group === "hitting" ? PLAYER_HITTING_COLUMNS : PLAYER_PITCHING_COLUMNS;
  return (
    `/api/v1/stats?stats=season&group=${group}&season=${season}&gameType=${gameType}&sportId=1` +
    `&playerPool=${pool}&limit=3000&fields=${[...LEAGUE_TABLE_FIELDS, ...columns].join(",")}`
  );
}

/**
 * A player's numbers, kept to the columns named.
 * @param {any} stat
 * @param {string[]} columns
 */
export function trimStats(stat, columns) {
  if (stat == null || typeof stat !== "object" || Array.isArray(stat))
    throw new Error("Invalid sports statistics");
  return Object.fromEntries(
    columns.filter((column) => column in stat).map((column) => [column, stat[column]]),
  );
}

/** @param {any} stat */
export const trimHitting = (stat) =>
  validateSportsData(BaseballPlayer.shape.hitting, trimStats(stat, PLAYER_HITTING_COLUMNS));

/** @param {any} stat */
export const trimPitching = (stat) =>
  validateSportsData(BaseballPlayer.shape.pitching, trimStats(stat, PLAYER_PITCHING_COLUMNS));

/**
 * Each player's numbers in one of MLB's league tables, by id.
 * @param {any} table
 * @param {(stat: any) => any} [trim]
 * @returns {Map<number, any>}
 */
export const indexSeasonStats = (table, trim = (stat) => stat) =>
  new Map(
    table == null
      ? []
      : readLeagueRows(table).map((row) => {
          validateSportsData(BaseballRoster.shape.players.element.shape.id, row.player.id);
          return [row.player.id, trim(row.stat)];
        }),
  );

/**
 * A player's stay on the injured list as the sheets name it, as "15-day IL", or null while he
 * isn't on it.
 * @param {any} entry a player on MLB's roster
 */
export function readInjury(entry) {
  const status = entry.status?.description ?? "";
  if (!INJURED.test(status)) return null;
  const days = /(\d+)-Day/.exec(status)?.[1];
  return days ? `${days}-day IL` : "IL";
}

/**
 * @param {any} entry a player on MLB's roster
 * @param {Map<number, any>} hitting
 * @param {Map<number, any>} pitching
 */
function describePlayer(entry, hitting, pitching) {
  const id = entry.person?.id;
  const player = {
    id,
    name: entry.person?.fullName ?? "",
    number: entry.jerseyNumber ?? "",
    position: entry.position?.abbreviation ?? "",
    injury: readInjury(entry),
  };
  return {
    ...player,
    ...(hitting.has(id) && { hitting: trimStats(hitting.get(id), HITTING_COLUMNS) }),
    ...(pitching.has(id) && { pitching: trimStats(pitching.get(id), PITCHING_COLUMNS) }),
  };
}

/** @param {any} entry */
export const isOnRoster = (entry) => {
  const status = entry.status?.description ?? "";
  return status === ACTIVE || INJURED.test(status);
};

/**
 * A club's active players and its injured list, each with his season so far.
 * @param {{ club: string, season: number, roster: any, hitting: Map<number, any>, pitching: Map<number, any> }} sources
 */
export function describeRoster({ club, season, roster, hitting, pitching }) {
  if (!Array.isArray(roster?.roster)) throw new Error("Invalid sports roster");
  return validateSportsData(BaseballRoster, {
    club,
    season,
    players: roster.roster
      .filter(isOnRoster)
      .map((entry) => describePlayer(entry, hitting, pitching)),
  });
}
