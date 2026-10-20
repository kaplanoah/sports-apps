// A game's season series on its sheet before first pitch, from each regular season meeting of its
// two clubs so far, as the shared season series draws it.

import { readCalendarDate } from "#shared/days.js";
import { renderSeasonSeries as renderSeries } from "#shared/season-series.js";
import { nameTeam, renderClub } from "./clubs.js";
import { sortInScheduleOrder } from "./schedule-order.js";
import { listCountedGames } from "./season-games.js";

/** @type {import("#shared/season-series.js").TeamLooks} */
const LOOKS = { renderWinner: renderClub, renderLoser: nameTeam, nameTeam };

/**
 * @param {any} game
 * @param {string} first
 * @param {string} second
 */
const isMeetingOf = (game, first, second) =>
  (game.away === first && game.home === second) || (game.away === second && game.home === first);

/**
 * The two clubs' finished regular season games, each once, in schedule order.
 * @param {any[]} games every game of the season
 * @param {string} away
 * @param {string} home
 * @returns {import("#shared/season-series.js").Meeting[]}
 */
const listMeetings = (games, away, home) =>
  sortInScheduleOrder(
    listCountedGames(games).filter(
      (game) =>
        !game.postseason &&
        !game.allStar &&
        game.state === "final" &&
        game.score &&
        isMeetingOf(game, away, home),
    ),
  ).map((game) => ({
    day: readCalendarDate(game.date),
    away: { team: game.away, score: game.score[0] },
    home: { team: game.home, score: game.score[1] },
  }));

/**
 * The season series of a game still to be played, or nothing for one under way or over, one whose
 * clubs aren't both known, or before the page has the season's games. A postseason game comes once
 * the regular season, and so the series, is over.
 * @param {any} game
 * @param {any[] | null} games every game of the season, or null before they've loaded
 */
export function renderSeasonSeries(game, games) {
  if (game.state !== "pre" || !game.away || !game.home || !games) return false;
  const series = { away: game.away, home: game.home, isOver: Boolean(game.postseason) };
  return renderSeries(listMeetings(games, game.away, game.home), series, LOOKS);
}
