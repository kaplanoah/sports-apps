// Two teams' season series on their game's sheet before it starts: each regular season meeting so
// far, first to last, its winner and score and where it was played, under who won the series, or
// who leads it while the regular season goes on. Each league hands it its meetings and how it shows
// a team.

import { formatShortDate } from "./days.js";
import { html } from "./html.js";
import { describeSeriesLead } from "./series-text.js";
import { renderSheetPart } from "./sheet-part.js";

/** @typedef {import("./html.js").Markup} Markup */
/**
 * A finished meeting: the day it's listed on, and each team with its score.
 * @typedef {{ day: Date, away: { team: string, score: number }, home: { team: string, score: number } }} Meeting
 */
/**
 * How a league shows a team: its winner with its dot, the team it beat by name, and its name in
 * words.
 * @typedef {{ renderWinner: (team: string) => Markup, renderLoser: (team: string) => Markup | string, nameTeam: (team: string) => string }} TeamLooks
 */

export const SEASON_SERIES_TITLE = "Season series";

/** @param {Meeting} meeting */
function readResult(meeting) {
  const isHomeWin = meeting.home.score > meeting.away.score;
  const [winner, loser] = isHomeWin ? [meeting.home, meeting.away] : [meeting.away, meeting.home];
  return { winner, loser, place: isHomeWin ? "vs" : "at" };
}

/**
 * @param {Meeting} meeting
 * @param {TeamLooks} looks
 */
function renderMeeting(meeting, looks) {
  const { winner, loser, place } = readResult(meeting);
  return html`<li>
    <span class="meeting-day tabular">${formatShortDate(meeting.day)}</span>
    <span class="meeting-result">${looks.renderWinner(winner.team)}<span class="meeting-score tabular">${winner.score}-${loser.score}</span></span>
    <span>${place} ${looks.renderLoser(loser.team)}</span>
  </li>`;
}

/**
 * Who won the series, or leads it while it can still change: "Fever won 2-1", "Fever lead 2-1",
 * "Split 1-1", or "Tied 1-1".
 * @param {Meeting[]} meetings
 * @param {{ away: string, home: string, isOver: boolean, nameTeam: (team: string) => string }} series
 */
function describeSeasonSeries(meetings, { away, home, isOver, nameTeam }) {
  const countWins = (/** @type {string} */ team) =>
    meetings.filter((meeting) => readResult(meeting).winner.team === team).length;
  const [awayWins, homeWins] = [countWins(away), countWins(home)];
  const [wins, losses] = [Math.max(awayWins, homeWins), Math.min(awayWins, homeWins)];
  const leader = nameTeam(awayWins > homeWins ? away : home);
  if (!isOver) return describeSeriesLead({ leader, wins, losses, isOver });
  return wins === losses ? `Split ${wins}-${losses}` : `${leader} won ${wins}-${losses}`;
}

/**
 * The season series part: its meetings first to last under who won or leads it, or that the teams
 * haven't met.
 * @param {Meeting[]} meetings
 * @param {{ away: string, home: string, isOver: boolean }} series whether the regular season is
 *   over, as it is by a playoff game
 * @param {TeamLooks} looks
 */
export function renderSeasonSeries(meetings, series, looks) {
  if (!meetings.length)
    return renderSheetPart(
      SEASON_SERIES_TITLE,
      html`<p class="sheet-message">They haven't met this season</p>`,
    );
  // A stable sort, so a day's meetings keep the order the league lists them in.
  const ordered = [...meetings].sort((first, second) => first.day.getTime() - second.day.getTime());
  return renderSheetPart(
    SEASON_SERIES_TITLE,
    html`<ul class="meetings">
      ${ordered.map((meeting) => renderMeeting(meeting, looks))}
    </ul>`,
    describeSeasonSeries(ordered, { ...series, nameTeam: looks.nameTeam }),
  );
}
