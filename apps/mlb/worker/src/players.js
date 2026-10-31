import {
  BaseballPlayer,
  BaseballLastGames,
  BaseballHitters,
  validateSportsData,
} from "../../../../shared/worker/sports-schema.js";
import { addDays } from "#shared/days.js";
import { readClubId } from "./adapters/mlb.js";
import { readLeagueRows, readBaseballRate } from "./adapters/pitchers.js";
import { readInjury, trimHitting, trimPitching, trimStats } from "./rosters.js";

// What each player's sheet shows: his facts, from MLB's list of every player this season, his stay
// on the injured list, with why from ESPN's injury report (injuries.js), and his regular season and
// postseason so far, at the plate and on the mound, from every player's numbers; and the numbers of
// every hitter MLB ranks, which a hitter's sheet ranks him among. The store keeps
// each player on a club's roster (roster-updater.js), so a sheet reads only the store.

const PEOPLE_FIELDS = [
  "people",
  "id",
  "fullName",
  "useName",
  "useLastName",
  "currentAge",
  "birthCity",
  "birthStateProvince",
  "birthCountry",
  "height",
  "weight",
  "mlbDebutDate",
  "batSide",
  "pitchHand",
  "code",
].join(",");
const USA = "USA";
const GAME_LOG_FIELDS = [
  "people",
  "id",
  "stats",
  "group",
  "displayName",
  "splits",
  "date",
  "isHome",
  "opponent",
  "stat",
  "atBats",
  "hits",
  "doubles",
  "triples",
  "homeRuns",
  "rbi",
  "baseOnBalls",
  "strikeOuts",
  "inningsPitched",
  "numberOfPitches",
  "runs",
].join(",");
// A player's last games are read from the last few weeks, so each read stays small.
const GAME_LOG_DAYS = 30;
const LAST_GAMES = 5;
// What a game's line shows at the plate and on the mound.
const GAME_COLUMNS = {
  hitting: ["atBats", "hits", "doubles", "triples", "homeRuns", "rbi", "baseOnBalls"],
  pitching: ["inningsPitched", "numberOfPitches", "runs", "strikeOuts"],
};

/**
 * @param {number} season
 * @param {number} id
 */
export const namePlayerKey = (season, id) => `players/${season}-${id}`;

/** @param {number} season */
export const nameHittersKey = (season) => `hitters/${season}`;

/**
 * Every player in MLB this season, with his facts.
 * @param {number} season
 */
export const listPeopleRequest = (season) =>
  `/api/v1/sports/1/players?season=${season}&fields=${PEOPLE_FIELDS}`;

/**
 * Some players' games at the plate and on the mound in the last few weeks, regular season and
 * postseason together.
 * @param {number} season
 * @param {number[]} ids
 * @param {string} today the league's day, as YYYY-MM-DD
 */
export const listGameLogRequest = (season, ids, today) =>
  `/api/v1/people?personIds=${[...ids].sort((first, second) => first - second).join(",")}` +
  `&hydrate=stats(group=[hitting,pitching],type=[gameLog],season=${season},gameType=[R,P],` +
  `startDate=${addDays(today, -GAME_LOG_DAYS)},endDate=${today})&fields=${GAME_LOG_FIELDS}`;

/**
 * His games in one group of MLB's game logs, newest first, the few his sheet shows.
 * @param {any} person
 * @param {"hitting" | "pitching"} group
 */
function listLastGames(person, group) {
  const log = (person.stats ?? []).find(
    (/** @type {any} */ stats) => stats.group?.displayName === group,
  );
  return (log?.splits ?? [])
    .map((/** @type {any} */ game) => ({
      date: game.date,
      opponent: readClubId(game.opponent?.id),
      isHome: game.isHome === true,
      ...trimStats(game.stat ?? {}, GAME_COLUMNS[group]),
    }))
    .sort((/** @type {any} */ first, /** @type {any} */ second) =>
      second.date.localeCompare(first.date),
    )
    .slice(0, LAST_GAMES);
}

/**
 * A player's last games at the plate and on the mound, from MLB's game logs.
 * @param {any} person a person in MLB's answer to listGameLogRequest
 */
export const describeLastGames = (person) =>
  validateSportsData(BaseballLastGames, {
    hitting: listLastGames(person, "hitting"),
    pitching: listLastGames(person, "pitching"),
  });

/**
 * Each player's facts in MLB's list, by id.
 * @param {any} peopleResponse
 * @returns {Map<number, any>}
 */
export function indexPeople(peopleResponse) {
  if (peopleResponse != null && !Array.isArray(peopleResponse.people))
    throw new Error("Invalid sports people");
  return new Map(
    (peopleResponse?.people ?? []).map((/** @type {any} */ person) => {
      validateSportsData(BaseballPlayer.shape.id, person.id);
      return [person.id, person];
    }),
  );
}

/**
 * Where a player was born, as his sheet writes it: a city and state in the United States, or a
 * city and country elsewhere.
 * @param {any} person
 */
const describeBirthplace = (person) => {
  const place = person.birthCountry === USA ? person.birthStateProvince : person.birthCountry;
  return [person.birthCity, place].filter(Boolean).join(", ") || null;
};

/**
 * @param {any} person a player in MLB's list
 */
const describeFacts = (person) => ({
  bats: person.batSide?.code ?? null,
  throws: person.pitchHand?.code ?? null,
  age: person.currentAge ?? null,
  height: person.height ? person.height.replace(" ", "") : null,
  weight: person.weight ?? null,
  debut: person.mlbDebutDate ? Number(person.mlbDebutDate.slice(0, 4)) : null,
  birthplace: describeBirthplace(person),
});

/**
 * A player's numbers in one of MLB's tables, kept to what his sheet shows, or null when he has none.
 * @param {Map<number, any>} table
 * @param {number} id
 * @param {(stat: any) => any} trim
 */
const readNumbers = (table, id, trim) => (table.has(id) ? trim(table.get(id)) : null);

/**
 * Every player's numbers this season, by id: at the plate and on the mound, in the regular season
 * and the postseason.
 * @typedef {{ hitting: Map<number, any>, pitching: Map<number, any>, postseasonHitting: Map<number, any>, postseasonPitching: Map<number, any> }} PlayerNumbers
 */

/** @param {any} person @param {any} kept @param {((error: unknown) => void) | undefined} onFailure */
function describeRetainedFacts(person, kept, onFailure) {
  try {
    return validateSportsData(BaseballPlayer.shape.facts, person ? describeFacts(person) : null);
  } catch (error) {
    if (!onFailure) throw error;
    onFailure(error);
    return kept?.facts ?? null;
  }
}

/**
 * A player's sheet: his facts, his stay on the injured list and why, and his season at the plate
 * and on the mound, regular and post.
 * @param {PlayerNumbers & { entry: any, club: string, season: number, person: any, lastGames?: any, out?: import("./injuries.js").OutReason | null, kept?: any, failed?: Set<string>, onFactsFailure?: (error: unknown) => void }} sources
 *   `entry` is his line on the club's roster, `lastGames` what describeLastGames found, and `out`
 *   what ESPN's injury report says of him
 */
export function describePlayer({
  entry,
  club,
  season,
  person,
  lastGames = null,
  out = null,
  kept = null,
  failed = new Set(),
  onFactsFailure,
  ...numbers
}) {
  const id = entry.person.id;
  const injury = readInjury(entry);
  return validateSportsData(BaseballPlayer, {
    id,
    season,
    club,
    name: entry.person.fullName ?? person?.fullName ?? "",
    number: entry.jerseyNumber ?? "",
    position: entry.position?.abbreviation ?? "",
    facts: failed.has("people")
      ? (kept?.facts ?? null)
      : describeRetainedFacts(person, kept, onFactsFailure),
    injury,
    out: injury ? out : null,
    hitting: readNumbers(numbers.hitting, id, trimHitting),
    pitching: readNumbers(numbers.pitching, id, trimPitching),
    postseasonHitting: failed.has("postseasonHitting")
      ? (kept?.postseasonHitting ?? null)
      : readNumbers(numbers.postseasonHitting, id, trimHitting),
    postseasonPitching: failed.has("postseasonPitching")
      ? (kept?.postseasonPitching ?? null)
      : readNumbers(numbers.postseasonPitching, id, trimPitching),
    lastGames,
  });
}

/**
 * A share of a hitter's plate appearances, like his walks, to three places.
 * @param {number} count
 * @param {number} plateAppearances
 */
const shareOf = (count, plateAppearances) =>
  plateAppearances ? Math.round((count / plateAppearances) * 1000) / 1000 : 0;

/**
 * Every hitter MLB ranks, each with the numbers a hitter's sheet ranks.
 * @param {any} qualifiedResponse MLB's qualified hitters
 */
export const describeHitters = (qualifiedResponse) =>
  validateSportsData(BaseballHitters, {
    hitters: readLeagueRows(qualifiedResponse).map((row) => ({
      id: row.player.id,
      avg: readBaseballRate(row.stat.avg),
      obp: readBaseballRate(row.stat.obp),
      slg: readBaseballRate(row.stat.slg),
      ops: readBaseballRate(row.stat.ops),
      homeRuns: row.stat.homeRuns,
      rbi: row.stat.rbi,
      runs: row.stat.runs,
      stolenBases: row.stat.stolenBases,
      walkRate: shareOf(row.stat.baseOnBalls, row.stat.plateAppearances),
      strikeoutRate: shareOf(row.stat.strikeOuts, row.stat.plateAppearances),
    })),
  });
