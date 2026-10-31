import {
  BaseballRate,
  BaseballPitcherDetails,
  BaseballQualifiedStarters,
  validateSportsData,
} from "../../../../../shared/worker/sports-schema.js";
import { readEasternDay } from "#shared/days.js";
import { readClubId } from "./mlb.js";
import { fetchMlbJson } from "../mlb.js";
import { createReusedLoader, settleReads } from "../../../../../shared/worker/upstream.js";

// A pitcher's numbers change at most once a game, and the league's once a day of games.
const PITCHER_CACHE_SECONDS = 10 * 60;
const LEAGUE_CACHE_SECONDS = 6 * 60 * 60;
const LEAGUE_REUSE_MS = LEAGUE_CACHE_SECONDS * 1000;
const FASTBALLS = ["FF", "SI"];
const RECENT_STARTS = 3;
// MLB takes about 20 seconds to describe every starter's pitches at once, and one or two for a
// few dozen, so pitchers are read in parallel batches.
const BATCH_SIZE = 30;
const LARGEST_PERSON_ID = 9_999_999;

const PERSON_FIELDS = [
  "people",
  "id",
  "useName",
  "useLastName",
  "birthDate",
  "pitchHand",
  "code",
  "stats",
  "type",
  "displayName",
  "splits",
  "stat",
  "gamesStarted",
  "inningsPitched",
  "era",
  "strikeoutsPer9Inn",
  "walksPer9Inn",
  "percentage",
  "averageSpeed",
  "description",
].join(",");
const GAME_LOG_FIELDS = [
  "people",
  "id",
  "useLastName",
  "pitchHand",
  "code",
  "stats",
  "splits",
  "date",
  "stat",
  "gamesStarted",
  "inningsPitched",
  "numberOfPitches",
  "runs",
  "strikeOuts",
  "opponent",
  "isHome",
].join(",");
const QUALIFIED_FIELDS = [
  "stats",
  "splits",
  "player",
  "id",
  "stat",
  "era",
  "strikeoutsPer9Inn",
  "walksPer9Inn",
].join(",");
const APPEARANCE_FIELDS = [
  "stats",
  "splits",
  "player",
  "id",
  "stat",
  "gamesPlayed",
  "gamesStarted",
].join(",");

/** @param {number} season */
export const nameStartersKey = (season) => `starters/${season}`;

/**
 * @param {number} season
 * @param {number} id
 */
export const namePitcherKey = (season, id) => `pitchers/${season}-${id}`;

// Sorted, so the same pitchers make the same request and MLB's cache can answer it.
/** @param {number[]} ids */
const joinIds = (ids) => [...ids].sort((first, second) => first - second).join(",");

// The season line and pitch mix are the regular season's, like the qualified starters' they're
// ranked against; the game logs include the postseason's.
/**
 * @param {number} season
 * @param {number[]} ids
 */
export const listPeopleRequest = (season, ids) =>
  `/api/v1/people?personIds=${joinIds(ids)}` +
  `&hydrate=stats(group=[pitching],type=[season,pitchArsenal],season=${season})` +
  `&fields=${PERSON_FIELDS}`;

/**
 * @param {number} season
 * @param {number[]} ids
 */
export const listGameLogRequest = (season, ids) =>
  `/api/v1/people?personIds=${joinIds(ids)}` +
  `&hydrate=stats(group=[pitching],type=[gameLog],season=${season},gameType=[R,F,D,L,W])` +
  `&fields=${GAME_LOG_FIELDS}`;

/** @param {number} season */
export const listQualifiedRequest = (season) =>
  `/api/v1/stats?stats=season&group=pitching&season=${season}&sportId=1&playerPool=qualified` +
  `&limit=1000&fields=${QUALIFIED_FIELDS}`;

/**
 * Every pitcher's games and starts in the regular season (R) or the postseason (P).
 * @param {number} season
 * @param {"R" | "P"} gameType
 */
export const listAppearancesRequest = (season, gameType) =>
  `/api/v1/stats?stats=season&group=pitching&season=${season}&gameType=${gameType}&sportId=1` +
  `&playerPool=all&limit=3000&fields=${APPEARANCE_FIELDS}`;

/**
 * The rows of one of MLB's league tables.
 * @param {any} leagueResponse
 * @returns {any[]}
 */
export function readLeagueRows(leagueResponse) {
  if (!Array.isArray(leagueResponse?.stats)) throw new Error("Invalid sports table");
  const rows = leagueResponse.stats[0]?.splits ?? [];
  if (!Array.isArray(rows)) throw new Error("Invalid sports table");
  return rows;
}

/** @param {any} qualifiedResponse */
export const listQualifiedIds = (qualifiedResponse) =>
  describeStarters(qualifiedResponse, new Map()).starters.map((row) => row.id);

/**
 * The pitchers in batches of as many as one request reads.
 * @param {number[]} ids
 */
export function splitIntoBatches(ids) {
  const batches = [];
  for (let start = 0; start < ids.length; start += BATCH_SIZE)
    batches.push(ids.slice(start, start + BATCH_SIZE));
  return batches;
}

/**
 * Every person MLB describes for `ids`, read in parallel batches.
 * @param {(path: string) => Promise<any>} fetchJson
 * @param {(ids: number[]) => string} nameRequest
 * @param {number[]} ids
 */
export async function fetchPeople(fetchJson, nameRequest, ids) {
  const batches = splitIntoBatches(ids);
  const answers = await settleReads(batches.map((batch) => fetchJson(nameRequest(batch))));
  return answers.flatMap((answer, index) => readPeople(answer, batches[index]));
}

/**
 * @param {any} answer
 * @param {number[]} ids
 * @param {(error: unknown, id: number | null) => void} [onFailure]
 * @returns {any[]}
 */
export function readPeople(answer, ids, onFailure) {
  if (!Array.isArray(answer?.people)) throw new Error("Invalid sports people");
  const people = new Map();
  const seen = new Set();
  for (const person of answer.people) {
    const id = BaseballPitcherDetails.shape.id.safeParse(person?.id).success ? person.id : null;
    if (id != null && !ids.includes(id)) {
      onFailure?.(new Error("Invalid sports identity"), null);
      continue;
    }
    try {
      validateSportsData(BaseballPitcherDetails.shape.id, person?.id);
      if (seen.has(person.id)) throw new Error("Invalid sports identity");
      seen.add(person.id);
      people.set(person.id, person);
    } catch (error) {
      people.delete(id);
      if (!onFailure) throw error;
      onFailure(error, id);
    }
  }
  return [...people.values()];
}

/**
 * @param {any} answer
 * @param {number[]} ids
 * @param {(error: unknown) => void} onFailure
 */
export function readPeopleBatch(answer, ids, onFailure) {
  const failed = new Set();
  let hasUnknownFailure = false;
  const people = new Map(
    readPeople(answer, ids, (error, id) => {
      if (id == null) hasUnknownFailure = true;
      else failed.add(id);
      onFailure(error);
    }).map((person) => [person.id, person]),
  );
  if (hasUnknownFailure) for (const id of ids) if (!people.has(id)) failed.add(id);
  return { people, failed };
}

/**
 * @param {any} person
 * @param {string} type
 * @returns {any[]}
 */
const readStats = (person, type) =>
  person?.stats?.find((/** @type {any} */ entry) => entry.type?.displayName === type)?.splits || [];

/**
 * @param {number | string | null | undefined} value
 * @param {number} places
 */
const roundTo = (value, places) => {
  const number = readBaseballRate(value);
  return number == null ? null : Math.round(number * 10 ** places) / 10 ** places;
};

/** @param {number | string | null | undefined} value */
export function readBaseballRate(value) {
  const rate = validateSportsData(BaseballRate, value ?? null);
  return rate == null || Number.isNaN(Number(rate)) ? null : Number(rate);
}

// The fastball he throws most, a four-seamer or a sinker, stands for how hard he throws, to the
// tenth of a mile an hour the sheet shows.
/** @param {any[]} arsenal */
function readFastballSpeed(arsenal) {
  validateSportsData(BaseballPitcherDetails.shape.pitches, arsenal.map(describePitch));
  const fastballs = arsenal
    .filter((pitch) => FASTBALLS.includes(pitch.stat?.type?.code))
    .sort((first, second) => second.stat.percentage - first.stat.percentage);
  return roundTo(fastballs[0]?.stat.averageSpeed, 1);
}

/**
 * The season's qualified starters and their numbers, each starter's speed from `speeds`.
 * @param {any} qualifiedResponse
 * @param {Map<number, number | null>} speeds
 */
export const describeStarters = (qualifiedResponse, speeds) =>
  validateSportsData(BaseballQualifiedStarters, {
    starters: readLeagueRows(qualifiedResponse).map((row) => ({
      id: row.player.id,
      era: readBaseballRate(row.stat.era),
      k9: readBaseballRate(row.stat.strikeoutsPer9Inn),
      bb9: readBaseballRate(row.stat.walksPer9Inn),
      speed: speeds.get(row.player.id) ?? null,
    })),
  });

/**
 * Each person's fastball speed, by id.
 * @param {any[]} people
 */
export const readSpeeds = (people) =>
  new Map(people.map((person) => [person.id, readFastballSpeed(readArsenal(person))]));

/** @param {any} person */
const readArsenal = (person) =>
  readStats(person, "pitchArsenal").filter((pitch) => pitch.stat?.type?.code);

const MEASURES = { era: "low", k9: "high", bb9: "low", speed: "high" };

/**
 * A rank counts only the starters strictly better, so tied starters share one.
 * @param {any[]} starters
 * @param {keyof typeof MEASURES} key
 * @param {number | null} value
 */
function rankAmong(starters, key, value) {
  const values = starters.map((starter) => starter[key]).filter(Number.isFinite);
  if (!Number.isFinite(value) || !values.length) return null;
  const isBetter = (/** @type {number} */ other) =>
    MEASURES[key] === "low" ? other < Number(value) : other > Number(value);
  return { rank: values.filter(isBetter).length + 1, of: values.length };
}

/**
 * @param {any[]} starters
 * @param {number} id
 */
function rankStarter(starters, id) {
  const starter = starters.find((candidate) => candidate.id === id);
  if (!starter) return null;
  return Object.fromEntries(
    Object.keys(MEASURES).map((key) => [
      key,
      rankAmong(starters, /** @type {keyof typeof MEASURES} */ (key), starter[key]),
    ]),
  );
}

/**
 * @param {any} line
 * @param {any[]} arsenal
 */
function describeLine(line, arsenal) {
  if (!line) return null;
  return {
    starts: line.gamesStarted ?? 0,
    ip: line.inningsPitched ?? null,
    era: line.era ?? null,
    k9: roundTo(line.strikeoutsPer9Inn, 1),
    bb9: roundTo(line.walksPer9Inn, 1),
    speed: readFastballSpeed(arsenal),
  };
}

const describePitch = (/** @type {any} */ { stat }) => ({
  code: stat.type.code,
  name: stat.type.description,
  share: roundTo(stat.percentage, 3),
  mph: roundTo(stat.averageSpeed, 1),
});

/**
 * Every start in a pitcher's game log, the newest first.
 * @param {any} gameLogPerson
 */
export const listStarts = (gameLogPerson) =>
  /** @type {any[]} */ (gameLogPerson?.stats?.[0]?.splits || [])
    .filter((game) => game.stat?.gamesStarted)
    .sort((first, second) => second.date.localeCompare(first.date))
    .map((game) => ({
      date: game.date,
      opp: readClubId(game.opponent?.id),
      home: Boolean(game.isHome),
      ip: game.stat.inningsPitched,
      runs: game.stat.runs,
      k: game.stat.strikeOuts,
      pitches: game.stat.numberOfPitches ?? null,
    }));

/**
 * A pitcher's side of the sheet as the store keeps it, from MLB's description of him and his game
 * log.
 * @param {any} person
 * @param {any} gameLogPerson
 */
export function describePitcher(person, gameLogPerson) {
  const arsenal = readArsenal(person);
  return validateSportsData(BaseballPitcherDetails, {
    id: person.id,
    firstName: person.useName ?? null,
    lastName: person.useLastName,
    hand: person.pitchHand?.code ?? null,
    birthDate: person.birthDate ?? null,
    line: describeLine(readStats(person, "season")[0]?.stat, arsenal),
    pitches: arsenal.map(describePitch),
    starts: listStarts(gameLogPerson).slice(0, RECENT_STARTS),
  });
}

/**
 * His age on the league's day of `now`.
 * @param {string | null} birthDate as YYYY-MM-DD
 * @param {number} now
 */
function measureAge(birthDate, now) {
  if (!birthDate) return null;
  const today = readEasternDay(now).date;
  const hasHadBirthday = today.slice(5) >= birthDate.slice(5);
  return Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (hasHadBirthday ? 0 : 1);
}

/**
 * Every qualified starter's number in each measure, from the lowest, which the sheet draws its
 * curves from.
 * @param {any[]} starters
 */
const listMeasureValues = (starters) =>
  Object.fromEntries(
    Object.keys(MEASURES).map((key) => [
      key,
      starters
        .map((starter) => starter[key])
        .filter(Number.isFinite)
        .sort((first, second) => first - second),
    ]),
  );

/**
 * The sheet's side for a pitcher, ranked among the season's qualified starters.
 * @param {ReturnType<typeof describePitcher>} pitcher
 * @param {{ starters: any[] }} qualified
 * @param {number} now
 */
export function composePitcher({ birthDate, ...pitcher }, { starters }, now) {
  return {
    ...pitcher,
    age: measureAge(birthDate, now),
    ranks: rankStarter(starters, pitcher.id),
    starters: { count: starters.length, values: listMeasureValues(starters) },
  };
}

/** @param {URLSearchParams} searchParams */
export function readPersonId(searchParams) {
  const id = Number(searchParams.get("id"));
  return Number.isInteger(id) && id > 0 && id <= LARGEST_PERSON_ID ? id : null;
}

/**
 * @param {object} [options]
 * @param {(input: string, init: object) => Promise<Response>} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
export function createPitcherReader({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  /** @param {number} season */
  async function fetchQualified(season) {
    /** @param {string} path */
    const fetchJson = (path) => fetchMlbJson(fetchImpl, path, LEAGUE_CACHE_SECONDS);
    const qualified = await fetchJson(listQualifiedRequest(season));
    const people = await fetchPeople(
      fetchJson,
      (ids) => listPeopleRequest(season, ids),
      listQualifiedIds(qualified),
    );
    return describeStarters(qualified, readSpeeds(people));
  }

  // Every sheet opened in a day ranks against one read of the league.
  const loadQualified = createReusedLoader(fetchQualified, LEAGUE_REUSE_MS, now);

  /**
   * @param {number} id
   * @param {number} season
   */
  async function fetchPitcher(id, season) {
    const [people, gameLogs] = await Promise.all([
      fetchMlbJson(fetchImpl, listPeopleRequest(season, [id]), PITCHER_CACHE_SECONDS),
      fetchMlbJson(fetchImpl, listGameLogRequest(season, [id]), PITCHER_CACHE_SECONDS),
    ]);
    const person = readPeople(people, [id])[0];
    const logs = readPeople(gameLogs, [id])[0];
    return person ? describePitcher(person, logs) : null;
  }

  return { fetchPitcher, loadQualified };
}
