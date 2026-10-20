// MLB's feeds read into one snapshot, as the steps of buildSnapshot: the games (feed-games.js), the
// standings (feed-standings.js), the postseason's series (feed-postseason.js), and the season's
// whole schedule (feed-schedule.js), from the requests in feed-requests.js. The page and the
// Worker read the league's data from here.
// Runs in both the browser page and the Worker, so it uses no DOM and no globals.

import { readEasternDay } from "#shared/days.js";
import * as PollSchedule from "#shared/poll-schedule.js";
import {
  applyLiveGames,
  buildSlateWithAllStar,
  hasBothClubs,
  hasClub,
  isLive,
  listScheduleGames,
  listScheduledGames,
} from "./feed-games.js";
import {
  buildSeries,
  groupPostseason,
  listPostseasonGames,
  readOfficialField,
  splitPostseasonGames,
} from "./feed-postseason.js";
import {
  findMissingFields,
  listMlbRequests,
  listPitcherRequest,
  nameLiveGameRequest,
} from "./feed-requests.js";
import { buildSchedule } from "./feed-schedule.js";
import {
  buildStandings,
  countScheduledGames,
  hasEveryDivision,
  projectField,
  readRecords,
} from "./feed-standings.js";

// The shape of a snapshot, and of the season record saved from it, which a page reads only when it
// knows it.
export const SNAPSHOT_VERSION = 1;

// MLB caches its responses for 20 seconds, so polling much faster only refetches the same answer.
export const POLL_LIVE_MS = 30 * 1000;
// From the 9th inning on, any pitch can end a game, so it's followed a little faster than MLB's
// cache turns over.
export const POLL_CLOSING_MS = 15 * 1000;
const CLOSING_INNING = 9;

// Only the starters of the games the page lists are looked up, and those come from the slate.
export function listStarterIds(slate) {
  if (!slate) return [];
  const days = [slate.today, slate.nextDay, slate.lastNight].filter(Boolean);
  const games = [...days.flatMap((day) => day.games), slate.lastFinal, slate.previous, slate.next]
    .flat()
    .filter(Boolean);
  return [
    ...new Set(games.flatMap((game) => (game.starters || []).filter(Boolean).map(({ id }) => id))),
  ];
}

// The starters only add to the games, so the games still show when MLB can't name them.
async function fetchPitchers(getJson, ids) {
  if (!ids.length) return null;
  try {
    return await getJson(listPitcherRequest(ids), "pitchers");
  } catch {
    return null;
  }
}

const readUnlessFailed = (promise) => promise.catch(() => null);

/**
 * Each game the schedule says is being played, as MLB's live feed has it, by id. One whose read
 * fails is left out, so the schedule's copy of it stands.
 * @param {(path: string, name: string) => Promise<any>} getJson
 * @param {any} schedule
 */
async function readLiveGames(getJson, schedule) {
  const live = listScheduleGames(schedule).filter(isLive);
  const feeds = await Promise.all(
    live.map((game) => readUnlessFailed(getJson(nameLiveGameRequest(game.gamePk), "liveGame"))),
  );
  return Object.fromEntries(
    live.map((game, index) => [String(game.gamePk), feeds[index]]).filter(([, feed]) => feed),
  );
}

// The season's dates come first because they decide how far back the schedule reaches, and the
// games come before the standings, since a game that just ended is what makes them worth reading
// again. The starters come last, since which games the slate lists depends on the standings,
// which set the postseason's field. `getJson` is handed each request's name as well as its path.
// The bracket and the games can't do without the postseason and the schedule, but they can
// without the season's dates, the standings, or the season's whole schedule, which the snapshot
// then lists as missing.
export async function fetchResponses(getJson, season, now = Date.now()) {
  const seasonDates = await readUnlessFailed(
    getJson(listMlbRequests(season, now).season, "season"),
  );
  const requests = listMlbRequests(season, now, readRegularSeasonEnd(seasonDates));
  const [postseason, schedule] = await Promise.all([
    getJson(requests.postseason, "postseason"),
    requests.schedule ? getJson(requests.schedule, "schedule") : null,
  ]);
  const [liveGames, standings, seasonGames] = await Promise.all([
    readLiveGames(getJson, schedule),
    readUnlessFailed(getJson(requests.standings, "standings")),
    readUnlessFailed(getJson(requests.seasonGames, "seasonGames")),
  ]);
  const responses = {
    season: seasonDates,
    standings,
    postseason,
    schedule,
    liveGames,
    seasonGames,
  };
  const { slate } = buildSnapshot(responses, { season, now });
  const pitchers = await fetchPitchers(getJson, listStarterIds(slate));
  return { ...responses, pitchers };
}

export async function fetchSnapshot(getJson, season, now = Date.now()) {
  return buildSnapshot(await fetchResponses(getJson, season, now), { season, now });
}

// A field is known only with the standings: a projected one comes from them, and a set one takes
// its clubs' records, and which series each game belongs to, from them.
export const hasKnownField = (snapshot) => !!snapshot.standings;

const readSpringStart = (seasonDates) => seasonDates?.seasons?.[0]?.springStartDate || null;
const readRegularSeasonEnd = (seasonDates) =>
  seasonDates?.seasons?.[0]?.regularSeasonEndDate || null;

// Which playoff series a game is in comes from the standings (findSeriesId), so once the playoffs
// list a club, a read without the standings leaves out what the series decide, each club's last
// and next games in the slate and the schedule's playoff games, and says so with `isSeriesKnown`,
// so the store keeps them as the last read with the standings had them.
/** @param {any} slate */
const leaveOutClubGames = ({ previous, next, ...slate }) => slate;

/**
 * The schedule's months without their playoff games, leaving out a month of nothing else.
 * @param {Record<string, any[]>} schedule
 */
const leaveOutPlayoffGames = (schedule) =>
  Object.fromEntries(
    Object.entries(schedule)
      .map(([month, games]) => [month, games.filter((game) => !game.postseason)])
      .filter(([, games]) => games.length > 0),
  );

/**
 * When each game the schedule holds that MLB put off or called off was to start, kept past the day
 * the slate shows, since a rainout's make-up is often set after midnight.
 * @param {any[]} games
 * @returns {string[]}
 */
const listPutOffStarts = (games) =>
  games
    .filter((game) => game.state === "off" && hasBothClubs(game) && game.start)
    .map((game) => game.start);

export function buildSnapshot(rawResponses, { season, now = Date.now() }) {
  const responses = {
    ...rawResponses,
    schedule: applyLiveGames(rawResponses.schedule, rawResponses.liveGames),
  };
  const games = responses.schedule ? listScheduledGames(responses.schedule) : [];
  const postseasonGames = listPostseasonGames(responses);
  const { records, clinches } = readRecords(responses.standings);
  const gamesBySeries = groupPostseason(postseasonGames, clinches);
  const official = readOfficialField(gamesBySeries, records);
  const hasStandings = hasEveryDivision(responses.standings);
  const teams = official || (hasStandings ? projectField(responses.standings) : {});
  const { series, log } = buildSeries(teams, gamesBySeries, readEasternDay(now).date);
  const { needed, calledOffIds } = splitPostseasonGames(gamesBySeries, log);
  const clubGames = [...games.filter((game) => game.type === "R"), ...needed];
  const isSeriesKnown = hasStandings || !postseasonGames.some(hasClub);
  const slate = responses.schedule ? buildSlateWithAllStar(responses, games, clubGames, now) : null;
  const schedule = buildSchedule(responses, {
    games: postseasonGames,
    gamesBySeries,
    calledOff: calledOffIds,
  });

  return {
    version: SNAPSHOT_VERSION,
    season,
    asOf: new Date(now).toISOString(),
    projected: !official,
    springStart: readSpringStart(responses.season),
    teams,
    series,
    log,
    standings: hasStandings
      ? buildStandings(responses.standings, clubGames, countScheduledGames(responses.seasonGames))
      : null,
    slate: slate && !isSeriesKnown ? leaveOutClubGames(slate) : slate,
    putOffStarts: listPutOffStarts(games),
    schedule: schedule && !isSeriesKnown ? leaveOutPlayoffGames(schedule) : schedule,
    isSeriesKnown,
    missing: findMissingFields(responses),
  };
}

const isClosingInning = (game) => game.state === "live" && game.inning >= CLOSING_INNING;

// A season with no slate, like a past one, has nothing to follow, so it's null.
export function choosePollDelay(snapshot, now = Date.now()) {
  const slate = snapshot && snapshot.slate;
  if (!slate) return null;
  const games = [
    ...[slate.today, slate.nextDay].filter(Boolean).flatMap((day) => day.games),
    slate.allStar,
  ].filter(Boolean);
  return PollSchedule.choosePollDelay({
    isLive: games.some((game) => game.state === "live"),
    starts: games
      .filter((game) => game.state === "pre" && !game.tbd)
      .map((game) => Date.parse(game.start)),
    putOffStarts: (snapshot.putOffStarts ?? []).map(Date.parse),
    liveMs: games.some(isClosingInning) ? POLL_CLOSING_MS : POLL_LIVE_MS,
    now,
  });
}

export { countFinals, listScheduleGames, readGameState } from "./feed-games.js";
export {
  BEST_OF,
  LEAGUES,
  countWinsNeeded,
  findFeederSeries,
  resolveBracket,
} from "./feed-postseason.js";
export {
  CHECKED_FIELDS,
  MLB_API,
  findMissingFields,
  listMlbRequests,
  listPitcherRequest,
  nameLiveGameRequest,
} from "./feed-requests.js";
export { SCHEDULE_EDITION, nameScheduleCollection, nameScheduleKey } from "./feed-schedule.js";
export { countSeasonGames, hasWonDivision, settleDivisionRaces } from "./feed-standings.js";
export { listClubs, readClubId, readMlbTeamId } from "./mlb-ids.js";
