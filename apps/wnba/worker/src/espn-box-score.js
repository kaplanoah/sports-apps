import { readEspnGameState } from "../../page/js/snapshot.js";
import { findTeamCodeByEspnId } from "../../page/js/teams.js";

// ESPN's game summary read as the league's box score (box-score.js), for while the league's CDN
// doesn't answer. ESPN numbers its players its own way, so each takes the league's id, which opens
// her sheet, from the season's list of players by her name on her team; one the list doesn't name
// has none.

/**
 * A name as both ESPN and the league write it, without accents, punctuation, or case.
 * @param {string} name
 */
const normalizeName = (name) =>
  name
    .normalize("NFD")
    .replace(/[^A-Za-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * A team's players on the season's list, by name.
 * @param {any} index the season's list of players (`player-index.js`), or null
 * @param {string | null} team
 */
const mapPlayersByName = (index, team) =>
  new Map(
    (index?.players ?? [])
      .filter((/** @type {any} */ player) => player.team === team)
      .map((/** @type {any} */ player) => [
        normalizeName(`${player.firstName} ${player.lastName}`),
        player,
      ]),
  );

/**
 * @param {any[]} statistics a team's stats in ESPN's box score
 * @param {string} name
 */
const readStat = (statistics, name) => statistics.find((stat) => stat.name === name)?.displayValue;

/**
 * @param {any[]} statistics
 * @param {string} name
 */
const readCount = (statistics, name) => Number(readStat(statistics, name) ?? 0);

// ESPN writes shooting as made-attempted, like 22-70.
/**
 * @param {any[]} statistics
 * @param {string} name
 */
const readShooting = (statistics, name) =>
  String(readStat(statistics, name) ?? "0-0")
    .split("-")
    .map(Number);

// ESPN's team stats count only its players' rebounds, where the league's count the team's too, as
// ESPN's plays do.
/**
 * @param {any} summary ESPN's game summary
 * @param {string} espnId ESPN's id of the team
 */
const countRebounds = (summary, espnId) =>
  (summary.plays ?? []).filter(
    (/** @type {any} */ play) =>
      String(play.team?.id) === espnId && /^(Offensive|Defensive) Rebound$/.test(play.type?.text),
  ).length;

/**
 * @param {any} entry one of ESPN's players in its box score, with her stats in `keys`' order
 * @param {string[]} keys
 * @param {Map<string, any>} named the team's players on the season's list, by name
 */
function describeEspnPlayer({ athlete, stats }, keys, named) {
  /** @param {string} key */
  const read = (key) => Number(stats[keys.indexOf(key)] ?? 0);
  const listed = named.get(normalizeName(athlete.displayName));
  const [firstName, ...lastNames] = athlete.displayName.split(" ");
  return {
    id: listed ? Number(listed.id) : null,
    firstName: listed?.firstName ?? firstName,
    lastName: listed?.lastName ?? lastNames.join(" "),
    minutes: read("minutes"),
    points: read("points"),
    rebounds: read("rebounds"),
    assists: read("assists"),
    fouls: read("fouls"),
  };
}

/**
 * @param {any} summary ESPN's game summary
 * @param {any} competitor
 * @param {any} index
 */
function describeEspnTeam(summary, competitor, index) {
  const espnId = String(competitor.team.id);
  const team = findTeamCodeByEspnId(espnId);
  const isTeam = (/** @type {any} */ entry) => String(entry.team?.id) === espnId;
  const statistics = summary.boxscore.teams?.find(isTeam)?.statistics ?? [];
  const [group] = summary.boxscore.players?.find(isTeam)?.statistics ?? [];
  const athletes = (group?.athletes ?? []).filter(
    (/** @type {any} */ entry) => !entry.didNotPlay && entry.stats?.length,
  );
  const named = mapPlayersByName(index, team);
  const players = athletes.map((/** @type {any} */ entry) =>
    describeEspnPlayer(entry, group.keys, named),
  );
  const benchPoints = players
    .filter((_, place) => !athletes[place].starter)
    .reduce((sum, player) => sum + player.points, 0);
  return {
    team,
    score: Number(competitor.score),
    periods: (competitor.linescores ?? []).map((/** @type {any} */ period) =>
      Number(period.displayValue),
    ),
    timeouts: null,
    stats: {
      fieldGoals: readShooting(statistics, "fieldGoalsMade-fieldGoalsAttempted"),
      threePointers: readShooting(
        statistics,
        "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
      ),
      freeThrows: readShooting(statistics, "freeThrowsMade-freeThrowsAttempted"),
      rebounds: countRebounds(summary, espnId),
      assists: readCount(statistics, "assists"),
      turnovers: readCount(statistics, "totalTurnovers"),
      paintPoints: readCount(statistics, "pointsInPaint"),
      benchPoints,
      biggestLead: readCount(statistics, "largestLead"),
    },
    players,
  };
}

/**
 * How many times a basket tied the game, from ESPN's plays.
 * @param {any} summary
 */
const countTimesTied = (summary) =>
  (summary.plays ?? []).filter(
    (/** @type {any} */ play) =>
      play.scoringPlay && play.awayScore === play.homeScore && play.awayScore > 0,
  ).length;

/**
 * ESPN's summary of a game as the league's box score of it, or null before ESPN has one.
 * @param {any} summary ESPN's game summary
 * @param {string} id the league's game id
 * @param {any} index the season's list of players (`player-index.js`), or null
 */
export function describeEspnBoxScore(summary, id, index) {
  const competition = summary?.header?.competitions?.[0];
  const state = readEspnGameState(competition?.status);
  const sides = Object.fromEntries(
    (competition?.competitors ?? []).map((/** @type {any} */ competitor) => [
      competitor.homeAway,
      competitor,
    ]),
  );
  if (state === "pre" || !sides.away || !sides.home || !summary.boxscore) return null;
  const away = describeEspnTeam(summary, sides.away, index);
  const home = describeEspnTeam(summary, sides.home, index);
  const leadChanges = readStat(summary.boxscore.teams?.[0]?.statistics ?? [], "leadChanges");
  return {
    id,
    source: "espn",
    state,
    period: Math.max(away.periods.length, home.periods.length) || null,
    leadChanges: leadChanges === undefined ? null : Number(leadChanges),
    timesTied: countTimesTied(summary),
    away,
    home,
  };
}
