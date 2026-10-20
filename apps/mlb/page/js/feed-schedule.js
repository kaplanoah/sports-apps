// The season's whole schedule, which the Games view lists, kept by the store a month to a document.
// Runs in both the browser page and the Worker, so it uses no DOM and no globals.

import { sortInScheduleOrder } from "./schedule-order.js";
import {
  LISTED_GAME_TYPES,
  isNumber,
  listPitchers,
  listStarters,
  normalizeAllStarGame,
  normalizeGame,
  summarizeGame,
} from "./feed-games.js";
import { listSeriesIds } from "./feed-postseason.js";

// The Games view lists every game of the season, which the store keeps a month to a document, apart
// from the season's record that pages follow through every live game, and saves again only as a
// game ends or the schedule changes.
/** @param {number} year */
export const nameScheduleCollection = (year) => `schedules-${year}`;

// What the schedule's games hold, raised whenever they hold more, so a past season saved before is
// read once more for it.
export const SCHEDULE_EDITION = 2;

/**
 * @param {number} year
 * @param {string} month "YYYY-MM"
 */
export const nameScheduleKey = (year, month) => `${nameScheduleCollection(year)}/${month}`;

// A postponed or suspended game is listed on the day it was to be played and again on the day it's
// played, and the later of two listings of the same day counts. MLB gives both listings the day
// it's played as their official date, so each takes the day it's listed on.
// Only the season's whole schedule names each game's ballpark, which a later listing keeps.
function listSeasonListings(...responses) {
  const listings = new Map();
  for (const day of responses.flatMap((response) => response?.dates ?? [])) {
    for (const game of day.games ?? []) {
      const key = `${game.gamePk} ${day.date}`;
      const venue = game.venue ?? listings.get(key)?.venue;
      if (LISTED_GAME_TYPES.has(game.gameType))
        listings.set(key, { ...game, officialDate: day.date, ...(venue && { venue }) });
    }
  }
  return [...listings.values()];
}

/**
 * Where a game is played, as the Games view and its search read it.
 * @param {any} venue MLB's
 */
const describeBallpark = (venue) =>
  venue?.name && venue.location?.city
    ? {
        name: venue.name,
        city: venue.location.city,
        state: venue.location.stateAbbrev ?? "",
        timeZone: venue.timeZone?.id ?? null,
      }
    : null;

// A club's own ballpark is the one it hosts most of its regular season games in, so a game it hosts
// anywhere else, like London or the Little League Classic, is at a neutral site.
function findHomeBallparks(listings) {
  const counts = new Map();
  for (const listing of listings) {
    const club = listing.teams?.home?.team?.id;
    const park = listing.venue?.id;
    if (listing.gameType !== "R" || !club || !park) continue;
    const parks = counts.get(club) ?? new Map();
    parks.set(park, (parks.get(park) ?? 0) + 1);
    counts.set(club, parks);
  }
  return new Map(
    [...counts].map(([club, parks]) => [
      club,
      [...parks].sort((first, second) => second[1] - first[1])[0][0],
    ]),
  );
}

/**
 * @param {any} listing
 * @param {Map<number, number>} homeBallparks
 */
const isAtNeutralSite = (listing, homeBallparks) => {
  const home = homeBallparks.get(listing.teams?.home?.team?.id);
  return !!home && !!listing.venue?.id && listing.venue.id !== home;
};

/** @param {{ wins?: number, losses?: number } | undefined} record */
const formatRecord = (record) =>
  isNumber(record?.wins) && isNumber(record?.losses) ? `${record.wins}-${record.losses}` : null;

// A regular season game that has been played shows each club's record as it stood with the game,
// which MLB gives after a final. A game still to come shows each club's record now, which the
// standings give, so the schedule keeps none for it. A postseason game's record is its series',
// which the page doesn't show.
function listRecords(game) {
  if (game.type !== "R" || game.state !== "final") return null;
  const records = [formatRecord(game.away.record), formatRecord(game.home.record)];
  return records.some(Boolean) ? records : null;
}

// Only what the row shows of each starter, his name and his arm, and his first name, which a search
// for him shows.
function listListedStarters(game, people) {
  const starters = listStarters(game, people)?.map((starter) =>
    starter?.name
      ? {
          id: starter.id,
          name: starter.name,
          hand: starter.hand,
          ...(starter.firstName && { firstName: starter.firstName }),
        }
      : null,
  );
  return starters?.some(Boolean) ? starters : null;
}

// A postseason game names its series and its game in it, and, while MLB says the series may not
// need it, that it's played only if necessary.
/**
 * @param {ReturnType<typeof normalizeGame>} game
 * @param {Map<string, string>} seriesIds each postseason game's series, by the game's id
 */
function describeSeriesPlace(game, seriesIds) {
  const series = seriesIds.get(game.id);
  if (!series) return null;
  const place = { series, number: game.number };
  return game.state === "pre" && game.ifNecessary ? { ...place, ifNecessary: true } : place;
}

// A game under way is listed as it was before it started, since the slate carries it while it's
// played, and only a final keeps its score.
/**
 * @param {any} listing MLB's listing of a game
 * @param {Map<number, any>} people each starter MLB describes, by id
 * @param {Map<string, string>} seriesIds each postseason game's series, by the game's id
 * @param {Map<number, number>} homeBallparks each club's own ballpark, by the club's MLB id
 */
function describeListedGame(listing, people, seriesIds, homeBallparks) {
  const isAllStar = listing.gameType === "A";
  const game = isAllStar ? normalizeAllStarGame(listing) : normalizeGame(listing);
  const { starters, networks, inning, half, outs, end, delay, postseason, score, ...summary } =
    summarizeGame(game, new Map());
  const records = listRecords(game);
  const listedStarters = isAllStar ? null : listListedStarters(game, people);
  const seriesPlace = postseason && !isAllStar ? describeSeriesPlace(game, seriesIds) : null;
  const ballpark = describeBallpark(listing.venue);
  return {
    date: game.date,
    ...summary,
    state: game.state === "live" ? "pre" : game.state,
    ...(game.state === "final" && { score }),
    ...(postseason && !isAllStar && { postseason }),
    ...seriesPlace,
    ...(isAllStar && { allStar: true }),
    ...(records && { records }),
    ...(listedStarters && { starters: listedStarters }),
    ...(ballpark && { ballpark }),
    ...(!isAllStar && isAtNeutralSite(listing, homeBallparks) && { neutral: true }),
  };
}

// The season's schedule names each starter it lists, and the starters' own read, the slate's.
function listScheduledPeople(responses, listings) {
  const people = new Map();
  for (const listing of listings) {
    for (const side of ["away", "home"]) {
      const person = listing.teams?.[side]?.probablePitcher;
      if (person?.useLastName) people.set(person.id, person);
    }
  }
  for (const [id, person] of listPitchers(responses)) people.set(id, person);
  return people;
}

/** @param {{ date: string }[]} games in schedule order */
function groupByMonth(games) {
  /** @type {Record<string, any[]>} */
  const months = {};
  for (const game of games) (months[game.date.slice(0, 7)] ??= []).push(game);
  return months;
}

/** @param {any} response one of MLB's schedules */
const hasDates = (response) => (response?.dates ?? []).length > 0;

// The season's whole schedule is read once a day, so the days around today, read with each update,
// and the postseason count over it. MLB drops a playoff game a series no longer needs from those
// as soon as the series ends, while the whole schedule can still list it, so a playoff game is
// listed only while they list it. A whole schedule MLB answers with no games saves nothing, and a
// postseason MLB answers with none drops no game.
/**
 * @param {any} responses
 * @param {{ games: { id: string }[], gamesBySeries: Record<string, any[]>, calledOff: Set<string> }} postseason
 *   the playoff games those list, each series' games, and the games a decided series didn't need
 */
export function buildSchedule(responses, { games: playoffGames, gamesBySeries, calledOff }) {
  if (!hasDates(responses.seasonGames)) return null;
  const seasonListings = listSeasonListings(responses.seasonGames);
  const people = listScheduledPeople(responses, seasonListings);
  const seriesIds = listSeriesIds(gamesBySeries);
  const homeBallparks = findHomeBallparks(seasonListings);
  const playoffIds = new Set(playoffGames.map((game) => game.id));
  const isStillListed = (game) =>
    !game.postseason || !hasDates(responses.postseason) || playoffIds.has(game.id);
  const games = listSeasonListings(responses.seasonGames, responses.postseason, responses.schedule)
    .map((listing) => describeListedGame(listing, people, seriesIds, homeBallparks))
    .filter((game) => isStillListed(game) && !calledOff.has(game.id));
  return groupByMonth(sortInScheduleOrder(games));
}
