import { html, setHtml } from "./html.js";
import { nameSeason } from "./league-words.js";

// The settings' Season picker: the seasons the store keeps, newest first, with the shown one always
// among them. It shows only once there's another season to pick.

/**
 * The years of the seasons the store keeps, newest first.
 * @param {{ id: string }[]} docs the store's `seasons` collection
 * @returns {string[]}
 */
export const listSeasonYears = (docs) =>
  docs
    .map((doc) => doc.id)
    .filter((id) => /^\d{4}$/.test(id))
    .sort()
    .reverse();

/**
 * The picker's options, newest first, each a season's year and its name.
 * @param {string[]} years
 * @param {number} shownYear
 * @param {Pick<import("./league-words.js").LeagueWords, "seasonSpansYears">} words
 */
export function listSeasonOptions(years, shownYear, words) {
  const shown = String(shownYear);
  return [...new Set([shown, ...years])]
    .sort()
    .reverse()
    .map((year) => ({ year, name: nameSeason(Number(year), words), isShown: year === shown }));
}

/**
 * @param {HTMLSelectElement} picker
 * @param {string[]} years
 * @param {number} shownYear
 * @param {Pick<import("./league-words.js").LeagueWords, "seasonSpansYears">} words
 */
export function fillSeasonPicker(picker, years, shownYear, words) {
  const listed = listSeasonOptions(years, shownYear, words);
  const options = listed.map(
    ({ year, name, isShown }) =>
      html`<option value="${year}" ${isShown ? "selected" : ""}>${name}</option>`,
  );
  setHtml(picker, html`${options}`);
  /** @type {HTMLElement} */ (picker.closest(".control-row")).hidden = listed.length < 2;
}
