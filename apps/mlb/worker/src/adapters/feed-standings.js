// The standings as the page shows them, from MLB's, each club with its next games, and the field
// they project before the postseason's is set.

import { compareStarts, hasClub, isNumber, listScheduleGames } from "./feed-games.js";
import { LEAGUES } from "../../../page/js/bracket-rules.js";
import { settleDivisionRaces } from "../../../page/js/standings-rules.js";
import { MLB_DIVISION, readClubId } from "../../../page/js/mlb-ids.js";

function listStandingsRows(response) {
  const rows = [];
  for (const divisionRecord of (response && response.records) || []) {
    const division = MLB_DIVISION[divisionRecord.division && divisionRecord.division.id];
    if (!division) continue;
    for (const record of divisionRecord.teamRecords || []) {
      const id = readClubId(record.team?.id);
      if (id) rows.push({ id, division, record });
    }
  }
  return rows;
}

// A postseason game can list a club before its opponent is known, so one known club is enough.
function describeUpcomingGame(game, opponent, home) {
  const upcoming = { at: game.start, date: game.date, home, tbd: game.tbd };
  if (opponent) upcoming.opp = opponent;
  if (game.type !== "R") upcoming.postseason = true;
  return upcoming;
}

function listUpcomingGames(games) {
  const upcoming = {};
  const gamesAhead = games
    .filter((game) => game.state === "pre" && hasClub(game))
    .sort(compareStarts);
  for (const game of gamesAhead) {
    for (const [club, opponent, home] of [
      [game.away.id, game.home.id, false],
      [game.home.id, game.away.id, true],
    ]) {
      if (club)
        (upcoming[club] = upcoming[club] || []).push(describeUpcomingGame(game, opponent, home));
    }
  }
  return upcoming;
}

const readRank = (value) => Number(value) || 99;

/**
 * A club's runs and its records at home and on the road, which its sheet ranks among every club's,
 * leaving out any MLB didn't answer with.
 * @param {any} record
 * @returns {Record<string, any>}
 */
function readClubNumbers(record) {
  const splits = record.records?.splitRecords ?? [];
  /** @param {string} type */
  const readSplit = (type) => {
    const split = splits.find((/** @type {any} */ each) => each.type === type);
    return split ? `${split.wins}-${split.losses}` : null;
  };
  const numbers = {
    rs: isNumber(record.runsScored) ? record.runsScored : null,
    ra: isNumber(record.runsAllowed) ? record.runsAllowed : null,
    home: readSplit("home"),
    road: readSplit("away"),
  };
  return Object.fromEntries(Object.entries(numbers).filter(([, value]) => value !== null));
}

function buildStandingsRow(id, record) {
  const row = {
    id,
    w: record.wins,
    l: record.losses,
    pct: record.winningPercentage,
    gb: record.divisionGamesBack,
    wcgb: record.wildCardGamesBack,
    elim: record.eliminationNumber,
    wce: record.wildCardEliminationNumber,
    lead: !!record.divisionLeader,
    // MLB's own marker: x a playoff spot, w a wild card, y the division, z a bye.
    clinch: record.clinchIndicator || null,
    wcrank: record.divisionLeader ? null : record.wildCardRank || null,
    rank: readRank(record.divisionRank),
  };
  return Object.assign(row, readClubNumbers(record));
}

/**
 * Each club's regular season games in the season's whole schedule, by club, leaving out a game
 * whose last listing MLB has cancelled, or null when the schedule wasn't read.
 * @param {any} seasonGames MLB's
 * @returns {Map<string, number> | null}
 */
export function countScheduledGames(seasonGames) {
  if (!seasonGames) return null;
  const lastListings = new Map();
  for (const game of listScheduleGames(seasonGames))
    if (game.gameType === "R") lastListings.set(game.gamePk, game);
  const counts = new Map();
  for (const game of lastListings.values()) {
    if (game.status?.codedGameState === "C") continue;
    for (const side of ["away", "home"]) {
      const club = readClubId(game.teams?.[side]?.team?.id);
      if (club) counts.set(club, (counts.get(club) ?? 0) + 1);
    }
  }
  return counts;
}

// `then` lets a copy saved before `next` starts still show what follows once it is under way.
export function buildStandings(response, games, scheduled) {
  const upcoming = listUpcomingGames(games);
  const divisions = {};
  for (const { id, division, record } of listStandingsRows(response)) {
    const row = buildStandingsRow(id, record);
    if (scheduled?.has(id)) row.scheduled = scheduled.get(id);
    const [next, then] = upcoming[id] || [];
    if (next) row.next = next;
    if (then) row.then = then;
    (divisions[division] = divisions[division] || []).push(row);
  }
  for (const rows of Object.values(divisions))
    rows.sort((first, second) => first.rank - second.rank).forEach((row) => delete row.rank);
  return { divisions: settleDivisionRaces(divisions) };
}

// MLB sometimes answers with no divisions, or only some, and a field projected from that
// would drop clubs that are still in it.
export function hasEveryDivision(response) {
  const divisions = new Set(listStandingsRows(response).map((row) => row.division));
  return Object.values(MLB_DIVISION).every((division) => divisions.has(division));
}

// League rank breaks ties on record because it already carries MLB's tiebreakers.
export function projectField(response) {
  const rows = listStandingsRows(response);
  const compareLeagueRank = (first, second) =>
    readRank(first.record.leagueRank) - readRank(second.record.leagueRank);
  const compareDivisionRank = (first, second) =>
    readRank(first.record.divisionRank) - readRank(second.record.divisionRank) ||
    compareLeagueRank(first, second);
  const comparePercentage = (first, second) =>
    Number(second.record.winningPercentage) - Number(first.record.winningPercentage) ||
    compareLeagueRank(first, second);
  const compareWildCardRank = (first, second) =>
    Number(first.record.wildCardRank) - Number(second.record.wildCardRank);

  const teams = {};
  for (const league of LEAGUES) {
    const leagueRows = rows.filter((row) => row.division.startsWith(league));
    const divisions = [...new Set(leagueRows.map((row) => row.division))];
    const leaders = divisions
      .map((division) =>
        leagueRows.filter((row) => row.division === division).sort(compareDivisionRank),
      )
      .map((divisionRows) => divisionRows[0])
      .sort(comparePercentage);
    const leaderIds = new Set(leaders.map((row) => row.id));
    const wildCards = leagueRows
      .filter((row) => !leaderIds.has(row.id) && row.record.wildCardRank)
      .sort(compareWildCardRank);
    [...leaders.slice(0, 3), ...wildCards.slice(0, 3)].forEach((row, index) => {
      teams[row.id] = { league, seed: index + 1, w: row.record.wins, l: row.record.losses };
    });
  }
  return teams;
}

const readLeague = (division) => LEAGUES.find((league) => division.startsWith(league));

// MLB marks the club that clinched its league's best record "z".
export function readRecords(standings) {
  const records = {};
  const champions = new Set();
  const bestRecords = {};
  for (const { id, division, record } of listStandingsRows(standings)) {
    records[id] = { w: record.wins, l: record.losses };
    if (record.divisionRank === "1" && record.divisionLeader) champions.add(id);
    if (record.clinchIndicator === "z") bestRecords[readLeague(division)] = id;
  }
  return { records, clinches: { champions, bestRecords } };
}
