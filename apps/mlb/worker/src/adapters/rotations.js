import {
  BaseballClubStarts,
  BaseballRotationPitcher,
  validateSportsData,
} from "../../../../../shared/worker/sports-schema.js";
import { addDays } from "#shared/days.js";
import { listScheduleGames, readClubId, readGameState, readMlbTeamId } from "./mlb.js";
import { fetchMlbJson } from "../mlb.js";
import { listGameLogRequest, listStarts, readPeople } from "./pitchers.js";

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
  if (!Array.isArray(scheduleResponse?.dates)) throw new Error("Invalid sports schedule");
  return listScheduleGames(scheduleResponse)
    .filter((/** @type {any} */ game) => readGameState(game.status ?? {}) === "final")
    .map((/** @type {any} */ game) => ({
      date: game.officialDate,
      id: findClubSide(game, mlbTeamId)?.probablePitcher?.id,
    }))
    .filter((/** @type {{ id?: number }} */ start) => start.id != null);
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
export const listScheduleClubs = (scheduleResponse) => {
  if (!Array.isArray(scheduleResponse?.dates)) throw new Error("Invalid sports schedule");
  return [
    ...new Set(
      listScheduleGames(scheduleResponse)
        .flatMap((/** @type {any} */ game) => [game.teams?.away, game.teams?.home])
        .map((/** @type {any} */ side) => readClubId(side?.team?.id))
        .filter(Boolean),
    ),
  ];
};

/**
 * @typedef {import("../../../../../shared/worker/sports-schema.js").RotationPitcherRecord} RotationPitcher
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
  return validateSportsData(BaseballClubStarts, { club, from, through, games, pitchers: kept });
}

/**
 * Whether a club's starts reach the two weeks before `date`, both back and up to its day before,
 * or up to today for a later day, since no game after today has been played.
 * @param {{ from: string, through?: string }} clubStarts
 * @param {string} date
 * @param {string} today MLB's day now
 */
export function coversDay({ from, through }, date, today) {
  const dayBefore = addDays(date, -1);
  const lastPlayed = dayBefore < today ? dayBefore : today;
  return from <= addDays(date, -LOOKBACK_DAYS) && !!through && through >= lastPlayed;
}

/**
 * A pitcher as the rotation shows him, from his game log.
 * @param {any} gameLogPerson
 * @returns {RotationPitcher}
 */
export const describeRotationPitcher = (gameLogPerson) =>
  validateSportsData(BaseballRotationPitcher, {
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
export const describeKeptRotationPitcher = ({ id, lastName, hand, starts }) =>
  validateSportsData(BaseballRotationPitcher, {
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
 */
export function createRotationReader({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
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
      (gameLogs ? readPeople(gameLogs, ids) : []).map((person) => [
        person.id,
        describeRotationPitcher(person),
      ]),
    );
    return describeClubStarts({ club, from, through, schedule, pitchers });
  }

  return fetchClubStarts;
}
