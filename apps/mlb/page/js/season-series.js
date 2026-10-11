// A game's season series on its sheet before first pitch: each regular season meeting of its two
// clubs so far, its winner and score and where it was played, under who won the series, or who
// leads it while the regular season goes on.

import { formatShortDate, readCalendarDate } from "#shared/days.js";
import { html } from "#shared/html.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { nameTeam, renderClub } from "./clubs.js";

const TITLE = "Season series";

/**
 * @param {any} game
 * @param {string} first
 * @param {string} second
 */
const isMeetingOf = (game, first, second) =>
  (game.away === first && game.home === second) || (game.away === second && game.home === first);

/**
 * The two clubs' finished regular season games, first to last.
 * @param {any[]} games every game of the season
 * @param {string} away
 * @param {string} home
 */
const listMeetings = (games, away, home) =>
  games
    .filter(
      (game) =>
        !game.postseason &&
        !game.allStar &&
        game.state === "final" &&
        game.score &&
        isMeetingOf(game, away, home),
    )
    .sort((first, second) => Date.parse(first.start) - Date.parse(second.start));

/** @param {any} meeting */
function readResult(meeting) {
  const [awayRuns, homeRuns] = meeting.score;
  const isHomeWin = homeRuns > awayRuns;
  return {
    winner: isHomeWin ? meeting.home : meeting.away,
    loser: isHomeWin ? meeting.away : meeting.home,
    score: `${Math.max(awayRuns, homeRuns)}-${Math.min(awayRuns, homeRuns)}`,
    place: isHomeWin ? "vs" : "at",
  };
}

/** @param {any} meeting */
function renderMeeting(meeting) {
  const { winner, loser, score, place } = readResult(meeting);
  return html`<li>
    <span class="meeting-day tabular">${formatShortDate(readCalendarDate(meeting.date))}</span>
    <span class="meeting-result">${renderClub(winner)}<span class="meeting-score tabular">${score}</span></span>
    <span>${place} ${nameTeam(loser)}</span>
  </li>`;
}

/**
 * Who won the series, or leads it while it can still change.
 * @param {any[]} meetings
 * @param {{ away: string, home: string, isOver: boolean }} clubs
 */
function describeSeries(meetings, { away, home, isOver }) {
  const countWins = (/** @type {string} */ club) =>
    meetings.filter((meeting) => readResult(meeting).winner === club).length;
  const [awayWins, homeWins] = [countWins(away), countWins(home)];
  const high = Math.max(awayWins, homeWins);
  const low = Math.min(awayWins, homeWins);
  if (awayWins === homeWins) return `${isOver ? "Split" : "Tied"} ${high}-${low}`;
  const leader = nameTeam(awayWins > homeWins ? away : home);
  return `${leader} ${isOver ? "won" : "lead"} ${high}-${low}`;
}

/**
 * The season series of a game still to be played, or nothing for one under way or over, one whose
 * clubs aren't both known, or before the page has the season's games.
 * @param {any} game
 * @param {any[] | null} games every game of the season, or null before they've loaded
 */
export function renderSeasonSeries(game, games) {
  if (game.state !== "pre" || !game.away || !game.home || !games) return false;
  const meetings = listMeetings(games, game.away, game.home);
  if (!meetings.length)
    return renderSheetPart(TITLE, html`<p class="sheet-message">They haven't met this season</p>`);
  const isOver = Boolean(game.postseason);
  return renderSheetPart(
    TITLE,
    html`<ul class="meetings">
      ${meetings.map(renderMeeting)}
    </ul>`,
    describeSeries(meetings, { away: game.away, home: game.home, isOver }),
  );
}
