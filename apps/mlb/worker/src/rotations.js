import { addDays, readEasternDay } from "#shared/days.js";
import { readClubId, readGameState, readMlbTeamId } from "../../page/js/snapshot.js";
import { DATE_RULE, fetchMlbJson, readDateParam } from "./mlb.js";
import { listGameLogRequest, listStarts } from "./pitchers.js";
import { noteLeagueRead } from "../../../../shared/worker/store-reads.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";

// A club that hasn't named a game's starter: who started its last games, how each of those starts
// went, and the rest each pitcher would have by the game's day. The store keeps each club's
// recent starts for the current season (pitcher-updater.js), so the sheet reads MLB itself only
// for a day whose last two weeks the store's starts don't reach, and the store counts each time it
// does for the current season.

// A club's starts change at most once a game.
const ROTATION_CACHE_SECONDS = 10 * 60;
// Two weeks back reaches a full turn of the rotation, even across a bye before the postseason.
export const LOOKBACK_DAYS = 14;
const ROTATION_SIZE = 5;
const MS_PER_DAY = 86400000;

const SCHEDULE_FIELDS = [
  "dates",
  "games",
  "officialDate",
  "status",
  "abstractGameState",
  "codedGameState",
  "detailedState",
  "teams",
  "away",
  "home",
  "team",
  "id",
  "probablePitcher",
].join(",");

/**
 * The finished games from `from` through `to` and who started them, for one club, or every club
 * when `mlbTeamId` is null.
 * @param {number | null} mlbTeamId
 * @param {string} from
 * @param {string} to
 */
export const listScheduleRequest = (mlbTeamId, from, to) =>
  `/api/v1/schedule?sportId=1${mlbTeamId ? `&teamId=${mlbTeamId}` : ""}` +
  `&startDate=${from}&endDate=${to}&gameType=R,F,D,L,W&hydrate=probablePitcher` +
  `&fields=${SCHEDULE_FIELDS}`;

/**
 * @param {number} season
 * @param {string} club
 */
export const nameRotationKey = (season, club) => `rotations/${season}-${club}`;

/**
 * @param {any} game
 * @param {number} mlbTeamId
 */
const findClubSide = (game, mlbTeamId) =>
  [game.teams?.away, game.teams?.home].find((side) => side?.team?.id === mlbTeamId);

// A finished game names the pitcher who started it.
/**
 * @param {any} scheduleResponse
 * @param {number} mlbTeamId
 * @returns {{ date: string, id: number }[]}
 */
function listClubStarts(scheduleResponse, mlbTeamId) {
  return (scheduleResponse?.dates || [])
    .flatMap((/** @type {any} */ day) => day.games || [])
    .filter((/** @type {any} */ game) => readGameState(game.status ?? {}) === "final")
    .map((/** @type {any} */ game) => ({
      date: game.officialDate,
      id: findClubSide(game, mlbTeamId)?.probablePitcher?.id,
    }))
    .filter((/** @type {{ id?: number }} */ start) => start.id);
}

/**
 * Who started the club's finished games in the schedule.
 * @param {any} scheduleResponse
 * @param {string} club
 */
export const listClubStarterIds = (scheduleResponse, club) => [
  ...new Set(
    listClubStarts(scheduleResponse, /** @type {number} */ (readMlbTeamId(club))).map(
      (start) => start.id,
    ),
  ),
];

/**
 * Every club with a game in the schedule.
 * @param {any} scheduleResponse
 * @returns {string[]}
 */
export const listScheduleClubs = (scheduleResponse) => [
  ...new Set(
    (scheduleResponse?.dates || [])
      .flatMap((/** @type {any} */ day) => day.games || [])
      .flatMap((/** @type {any} */ game) => [game.teams?.away, game.teams?.home])
      .map((/** @type {any} */ side) => readClubId(side?.team?.id))
      .filter(Boolean),
  ),
];

/**
 * @typedef {object} RotationPitcher
 * @property {number} id
 * @property {string} name his last name
 * @property {string | null} hand
 * @property {{ date: string, ip: string, pitches: number | null }[]} starts his starts, the
 *   newest first
 */

/**
 * A club's finished games in a schedule from `from` through `through`, with who started each, and
 * those pitchers' starts: what its rotation on any day from two weeks after `from` to the day after
 * `through` is made from.
 * @param {object} parts
 * @param {string} parts.club
 * @param {string} parts.from
 * @param {string} parts.through
 * @param {any} parts.schedule MLB's schedule from `from` through `through`
 * @param {Map<number, RotationPitcher>} parts.pitchers each starter, by id
 */
export function describeClubStarts({ club, from, through, schedule, pitchers }) {
  const games = listClubStarts(schedule, /** @type {number} */ (readMlbTeamId(club)));
  const ids = [...new Set(games.map((game) => game.id))];
  const kept = ids.map((id) => pitchers.get(id)).filter(Boolean);
  return { club, from, through, games, pitchers: kept };
}

/**
 * Whether a club's starts reach the two weeks before `date`, both back and up to its day before,
 * or up to today for a later day, since no game after today has been played.
 * @param {{ from: string, through?: string }} clubStarts
 * @param {string} date
 * @param {string} today MLB's day now
 */
function coversDay({ from, through }, date, today) {
  const dayBefore = addDays(date, -1);
  const lastPlayed = dayBefore < today ? dayBefore : today;
  return from <= addDays(date, -LOOKBACK_DAYS) && !!through && through >= lastPlayed;
}

/**
 * A pitcher as the rotation shows him, from his game log.
 * @param {any} gameLogPerson
 * @returns {RotationPitcher}
 */
export const describeRotationPitcher = (gameLogPerson) => ({
  id: gameLogPerson.id,
  name: gameLogPerson.useLastName,
  hand: gameLogPerson.pitchHand?.code ?? null,
  starts: listStarts(gameLogPerson).map(({ date, ip, pitches }) => ({ date, ip, pitches })),
});

/**
 * A pitcher as the rotation shows him, from his side of the matchup sheet as the store keeps it.
 * @param {{ id: number, lastName: string, hand: string | null, starts: any[] }} side
 * @returns {RotationPitcher}
 */
export const describeKeptRotationPitcher = ({ id, lastName, hand, starts }) => ({
  id,
  name: lastName,
  hand,
  starts: starts.map(({ date, ip, pitches }) => ({ date, ip, pitches })),
});

/**
 * @param {string} earlier
 * @param {string} later
 */
const countDaysBetween = (earlier, later) =>
  Math.round((Date.parse(later) - Date.parse(earlier)) / MS_PER_DAY);

/**
 * @param {RotationPitcher} pitcher
 * @param {string} date
 */
function describeStarter(pitcher, date) {
  const start = pitcher.starts.find((candidate) => candidate.date < date);
  if (!start) return null;
  return {
    id: pitcher.id,
    name: pitcher.name,
    hand: pitcher.hand,
    start: { date: start.date, ip: start.ip, pitches: start.pitches },
    rest: countDaysBetween(start.date, date) - 1,
  };
}

/**
 * The club's last starters in the two weeks before `date`, the most recent first, as of that
 * morning.
 * @param {ReturnType<typeof describeClubStarts>} clubStarts
 * @param {string} date
 */
export function describeRotation({ club, games, pitchers }, date) {
  const counted = games
    .filter((game) => game.date >= addDays(date, -LOOKBACK_DAYS) && game.date < date)
    .sort((first, second) => second.date.localeCompare(first.date));
  const ids = [...new Set(counted.map((game) => game.id))].slice(0, ROTATION_SIZE);
  const starters = ids
    .map((id) => pitchers.find((pitcher) => pitcher.id === id))
    .filter((pitcher) => pitcher !== undefined)
    .map((pitcher) => describeStarter(pitcher, date))
    .filter((starter) => starter !== null)
    .sort((first, second) => first.rest - second.rest);
  return { club, date, starters };
}

/**
 * @param {object} [options]
 * @param {(input: string, init: object) => Promise<Response>} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
export function createRotationServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  /** @param {string} path */
  const fetchJson = (path) => fetchMlbJson(fetchImpl, path, ROTATION_CACHE_SECONDS);

  /**
   * @param {string} club
   * @param {string} date
   */
  async function fetchClubStarts(club, date) {
    const from = addDays(date, -LOOKBACK_DAYS);
    const through = addDays(date, -1);
    const schedule = await fetchJson(listScheduleRequest(readMlbTeamId(club), from, through));
    const ids = listClubStarterIds(schedule, club);
    const gameLogs = ids.length
      ? await fetchJson(listGameLogRequest(Number(date.slice(0, 4)), ids))
      : null;
    const pitchers = new Map(
      (gameLogs?.people || []).map((/** @type {any} */ person) => [
        person.id,
        describeRotationPitcher(person),
      ]),
    );
    return describeClubStarts({ club, from, through, schedule, pitchers });
  }

  /**
   * The club's starts the store keeps, null when they don't reach the two weeks before `date`, and
   * whether `date` is in the store's current season, each null when it can't be read.
   * @param {string} club
   * @param {string} date
   * @param {(key: string) => Promise<any>} readDoc
   */
  async function readSavedStarts(club, date, readDoc) {
    try {
      const [saved, current] = await Promise.all([
        readDoc(nameRotationKey(Number(date.slice(0, 4)), club)),
        readDoc("live/current"),
      ]);
      return {
        clubStarts: saved && coversDay(saved, date, readEasternDay(now()).date) ? saved : null,
        isCurrentSeason: Number(date.slice(0, 4)) === current?.season,
      };
    } catch (error) {
      console.error(`Reading ${club}'s starts from the store failed: ${describeError(error)}`);
      return { clubStarts: null, isCurrentSeason: false };
    }
  }

  /**
   * @param {URL} url
   * @param {(key: string) => Promise<any>} [readDoc] the store's documents, when the Worker has a
   *   store
   * @param {() => Promise<void>} [countLeagueRead] adds one to the store's count of sheets read
   *   from MLB
   */
  async function serveRotation(url, readDoc, countLeagueRead) {
    const club = url.searchParams.get("club") ?? "";
    if (!readMlbTeamId(club))
      return respondError(400, "invalid_argument", "club must be an MLB club");
    const date = readDateParam(url.searchParams);
    if (date == null) return respondError(400, "invalid_argument", DATE_RULE);
    try {
      const saved = readDoc ? await readSavedStarts(club, date, readDoc) : null;
      const hasStoreGap = Boolean(saved?.isCurrentSeason && !saved.clubStarts);
      const [clubStarts] = await Promise.all([
        saved?.clubStarts ?? fetchClubStarts(club, date),
        hasStoreGap && countLeagueRead && noteLeagueRead(`${club}'s starts`, countLeagueRead),
      ]);
      return respondJson(describeRotation(clubStarts, date));
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read MLB: ${describeError(error)}`);
    }
  }

  return { serveRotation };
}
