// The postseason's bracket: which series each game is in, the field the games set, and each
// series' wins, from MLB's postseason games.

import {
  compareEnds,
  compareStarts,
  hasBothClubs,
  hasClub,
  isFeedGamePlayedBy,
  listScheduledGames,
} from "./feed-games.js";

import { LEAGUES, countWinsNeeded, resolveBracket } from "../../../page/js/bracket-rules.js";
export * from "../../../page/js/bracket-rules.js";

/**
 * The postseason's games split by whether they're played: once a series is decided, the games it
 * still lists but no longer needs never happen.
 * @param {Record<string, any[]>} gamesBySeries
 * @param {any[]} log
 */
export function splitPostseasonGames(gamesBySeries, log) {
  const decided = new Set(
    log.filter((entry) => entry.kind === "clinch").map((entry) => entry.series),
  );
  /** @type {any[]} */
  const needed = [];
  /** @type {Set<string>} */
  const calledOffIds = new Set();
  for (const [seriesId, games] of Object.entries(gamesBySeries))
    for (const game of games)
      if (decided.has(seriesId) && game.state !== "final") calledOffIds.add(game.id);
      else needed.push(game);
  return { needed, calledOffIds };
}

/** @param {Record<string, { id: string }[]>} gamesBySeries */
export const listSeriesIds = (gamesBySeries) =>
  new Map(
    Object.entries(gamesBySeries).flatMap(([seriesId, games]) =>
      games.map((game) => [game.id, seriesId]),
    ),
  );

// The Worker reads the postseason feed again only now and then, so a game's listing in the
// schedule, read with each update, counts over it.
export const listPostseasonGames = (responses) =>
  listScheduledGames(responses.postseason, responses.schedule).filter((game) => game.type !== "R");

// MLB lists every possible postseason game in advance under placeholders ("AL 4/5 Winner",
// then "NYY/BOS" once the wild card clubs are set). A wild card host is the 3 seed if it won its
// division, else the 4. The 1 seed, the club with the league's best record, plays every game of DS1.
function findSeriesId(game, { champions, bestRecords }) {
  if (game.type === "W") return "WS";
  const { league } = game;
  if (!league) return null;
  const names = `${game.away.name} | ${game.home.name}`;
  const bestRecord = bestRecords[league];
  switch (game.type) {
    case "F":
      if (/#3 Seed|Wild Card #3/.test(names)) return `${league}_WC1`;
      if (/Wild Card #[12]/.test(names)) return `${league}_WC2`;
      return champions.has(game.home.id) ? `${league}_WC1` : `${league}_WC2`;
    case "D":
      if (/4\/5|#1 Seed/.test(names) || (bestRecord && isFeedGamePlayedBy(game, bestRecord)))
        return `${league}_DS1`;
      if (/3\/6|#2 Seed/.test(names) || (bestRecord && hasClub(game))) return `${league}_DS2`;
      return null;
    case "L":
      return `${league}_CS`;
    default:
      return null;
  }
}

export function groupPostseason(games, clinches) {
  const gamesBySeries = {};
  for (const game of games) {
    const seriesId = findSeriesId(game, clinches);
    if (seriesId) (gamesBySeries[seriesId] = gamesBySeries[seriesId] || []).push(game);
  }
  return gamesBySeries;
}

function isFieldComplete(teams) {
  const seats = Object.values(teams);
  const isSeatTaken = (league, seed) =>
    seats.some((team) => team.league === league && team.seed === seed);
  return (
    seats.length === 12 &&
    LEAGUES.every((league) => [1, 2, 3, 4, 5, 6].every((seed) => isSeatTaken(league, seed)))
  );
}

// Every wild card game is at the higher seed; the 1 and 2 seeds play no wild card game.
export function readOfficialField(gamesBySeries, records) {
  const teams = {};
  const seatClub = (id, league, seed) => {
    if (!id) return;
    const record = records[id];
    teams[id] = record ? { league, seed, w: record.w, l: record.l } : { league, seed };
  };
  for (const league of LEAGUES) {
    const listSeriesGames = (key) => gamesBySeries[`${league}_${key}`] || [];
    for (const [key, higherSeed, lowerSeed] of [
      ["WC1", 3, 6],
      ["WC2", 4, 5],
    ]) {
      const game = listSeriesGames(key)[0];
      if (!game) continue;
      seatClub(game.home.id, league, higherSeed);
      seatClub(game.away.id, league, lowerSeed);
    }
    const wildCardGames = [...listSeriesGames("WC1"), ...listSeriesGames("WC2")];
    const playedWildCard = (id) => wildCardGames.some((game) => isFeedGamePlayedBy(game, id));
    for (const [key, seed] of [
      ["DS1", 1],
      ["DS2", 2],
    ]) {
      const host = listSeriesGames(key)
        .flatMap((game) => [game.away.id, game.home.id])
        .find((id) => id && !playedWildCard(id));
      seatClub(host, league, seed);
    }
  }
  return isFieldComplete(teams) ? teams : null;
}

const isUnderWay = (game) => game.state === "live" || game.state === "final";

const isBetween = (game, teamA, teamB) =>
  [teamA, teamB].includes(game.away.id) && [teamA, teamB].includes(game.home.id);

// A game still live past midnight Eastern is dated the day before.
function findNextGame(games, today) {
  return games
    .filter((game) => game.state === "live" || (game.state === "pre" && game.date >= today))
    .sort((first, second) => first.number - second.number || compareStarts(first, second))[0];
}

function tallySeries(seriesId, games, round, teamA, teamB, today) {
  const record = { winsA: 0, winsB: 0 };
  const log = [];
  const need = countWinsNeeded(round);
  let winner = null;
  const seriesGames =
    teamA && teamB
      ? games.filter((game) => hasBothClubs(game) && isBetween(game, teamA, teamB))
      : [];
  if (seriesGames.some(isUnderWay)) record.started = true;
  const decided = seriesGames.filter((game) => game.state === "final").sort(compareEnds);
  for (const game of decided) {
    const won = game.away.score > game.home.score ? game.away.id : game.home.id;
    const lost = won === teamA ? teamB : teamA;
    // The game's own score, winner first, beside the series score.
    const runs = [
      Math.max(game.away.score, game.home.score),
      Math.min(game.away.score, game.home.score),
    ];
    if (won === teamA) record.winsA++;
    else record.winsB++;
    const score = won === teamA ? [record.winsA, record.winsB] : [record.winsB, record.winsA];
    if (score[0] >= need) {
      winner = won;
      log.push({
        at: game.end,
        kind: "clinch",
        series: seriesId,
        team: won,
        over: lost,
        score,
        runs,
      });
      break;
    }
    log.push({
      at: game.end,
      kind: "game",
      series: seriesId,
      won,
      lost,
      game: game.number,
      score,
      runs,
    });
  }
  if (!winner) {
    const next = findNextGame(games, today);
    if (next) record.next = { at: next.start, date: next.date, tbd: next.tbd, game: next.number };
  }
  return { record, log, winner };
}

export function buildSeries(teams, gamesBySeries, today) {
  const series = {};
  const log = [];
  resolveBracket(teams, (seriesId, round, teamA, teamB) => {
    const games = gamesBySeries[seriesId] || [];
    const tally = tallySeries(seriesId, games, round, teamA, teamB, today);
    series[seriesId] = tally.record;
    log.push(...tally.log);
    return tally.winner;
  });
  log.sort((first, second) => Date.parse(first.at) - Date.parse(second.at));
  return { series, log };
}
