// The title names the season it shows whenever that isn't a season being played: an earlier one,
// or the current one once its last game is final, until the next one starts.

import { nameSeason } from "./league-words.js";

/**
 * Whether a page shows, or has picked, a season other than the one the store says is current,
 * which is always an earlier one.
 * @param {number | null} shownYear
 * @param {number | null} currentYear
 */
export const isEarlierSeason = (shownYear, currentYear) =>
  currentYear !== null && shownYear !== currentYear;

/**
 * The year the title shows, or null while the shown season is being played.
 * @param {{ shownYear: number, currentYear: number | null, isSeasonOver: boolean }} season
 * @returns {number | null}
 */
export function chooseTitleYear({ shownYear, currentYear, isSeasonOver }) {
  return isEarlierSeason(shownYear, currentYear) || isSeasonOver ? shownYear : null;
}

/**
 * Shows the season starting in `year` in the title's #titleYear, by its name, or hides it.
 * @param {number | null} year
 * @param {Pick<import("./league-words.js").LeagueWords, "seasonSpansYears">} words
 */
export function showTitleYear(year, words) {
  const element = /** @type {HTMLElement} */ (document.getElementById("titleYear"));
  element.hidden = year === null;
  element.textContent = year === null ? "" : nameSeason(year, words);
}
