// A postseason game in the season's schedule names its series, as "AL_DS1" or "WS", and its game in
// it, so its row and its sheet can say where the series stood at that game.

import { describeSeriesAfterWin, describeSeriesLead } from "#shared/series-text.js";
import { nameSeries } from "./bracket.js";
import { nameTeam } from "./teams.js";
import { listCountedGames } from "./season-games.js";
import { countSeriesWinsNeeded, readSeriesFacts } from "./bracket-rules.js";

// Short names, since the label shares the row's middle with the time or score.
/** @param {string} seriesId */
export function nameRound(seriesId) {
  const { league, round } = readSeriesFacts(seriesId);
  if (round === "WC") return `${league} WC`;
  if (round === "WS") return "WS";
  return `${league}${round}`;
}

/** @param {{ series?: string, number?: number }} game */
export const isSeriesGame = (game) => !!game.series && !!game.number;

/** @param {{ series?: string, number?: number }} game a game that isSeriesGame */
export const nameSeriesGame = (game) =>
  `${nameSeries(/** @type {string} */ (game.series))} Game ${game.number}`;

/**
 * Each series' finals, by the series' id, each game once.
 * @param {any[]} games
 * @returns {Map<string, any[]>}
 */
export function groupSeriesFinals(games) {
  const finals = new Map();
  for (const game of listCountedGames(games)) {
    if (!isSeriesGame(game) || game.state !== "final") continue;
    if (!finals.has(game.series)) finals.set(game.series, []);
    finals.get(game.series).push(game);
  }
  return finals;
}

/** @param {{ away: string, home: string, score: number[] }} game */
const findWinner = (game) => (game.score[0] > game.score[1] ? game.away : game.home);

// A game counts its series through the finals up to it, itself too once it's over, so as it stood
// at first pitch and then as it stood after. Wins run away-home, like the clubs on either side.
/**
 * @param {any} game
 * @param {Map<string, any[]>} seriesFinals
 */
export function countSeriesWins(game, seriesFinals) {
  const winners = (seriesFinals.get(game.series) ?? [])
    .filter((final) => final.number <= game.number)
    .map(findWinner);
  /** @param {string} club */
  const countWins = (club) => winners.filter((winner) => winner === club).length;
  return [countWins(game.away), countWins(game.home)];
}

/**
 * @param {string} seriesId
 * @param {number[]} wins
 */
export const isSeriesDecided = (seriesId, wins) =>
  Math.max(...wins) >= countSeriesWinsNeeded(seriesId);

/**
 * How a final's winner left its series: "Guardians won to tie 2-2".
 * @param {any} game
 * @param {number[]} wins
 */
function describeFinalInSeries(game, [awayWins, homeWins]) {
  const winner = findWinner(game);
  const [wins, losses] = winner === game.away ? [awayWins, homeWins] : [homeWins, awayWins];
  return describeSeriesAfterWin({
    winner: nameTeam(winner),
    wins,
    losses,
    winsNeeded: countSeriesWinsNeeded(game.series),
  });
}

/**
 * Where the series stood at first pitch: "Tied 2-2" or "Guardians lead 3-1".
 * @param {any} game
 * @param {number[]} wins
 */
function describeSeriesBefore(game, [awayWins, homeWins]) {
  const isAwayLeading = awayWins > homeWins;
  return describeSeriesLead({
    leader: nameTeam(isAwayLeading ? game.away : game.home),
    wins: Math.max(awayWins, homeWins),
    losses: Math.min(awayWins, homeWins),
    isOver: isSeriesDecided(game.series, [awayWins, homeWins]),
  });
}

/**
 * Where a postseason game's series stood at it, for its sheet, or nothing while a club isn't known.
 * @param {any} game
 * @param {Map<string, any[]>} seriesFinals
 */
export function describeSeriesAt(game, seriesFinals) {
  if (!isSeriesGame(game) || !game.away || !game.home) return "";
  const wins = countSeriesWins(game, seriesFinals);
  return game.state === "final"
    ? describeFinalInSeries(game, wins)
    : describeSeriesBefore(game, wins);
}
