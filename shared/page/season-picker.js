import { html, setHtml } from "./html.js";
import { nameSeason } from "./league-words.js";

// The settings' Season picker: the seasons the store keeps, or those it last listed, newest first,
// with the current one and the shown one always among them. It shows only once there's another
// season to pick. Its row is drawn whole, so a reload shows it as it was before the page's code
// arrives.

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
 * The picker's options, newest first, each a season's year and its name, with the current one and
 * the shown one always among them.
 * @param {string[]} years
 * @param {{ shownYear: number, currentYear: number | null }} seasons
 * @param {Pick<import("./league-words.js").LeagueWords, "seasonSpansYears">} words
 */
export function listSeasonOptions(years, { shownYear, currentYear }, words) {
  const shown = String(shownYear);
  const current = currentYear === null ? [] : [String(currentYear)];
  return [...new Set([shown, ...current, ...years])]
    .sort()
    .reverse()
    .map((year) => ({ year, name: nameSeason(Number(year), words), isShown: year === shown }));
}

/**
 * Reads the seasons the store keeps with `load`, keeping the answer to the newest read that has
 * one, so a read that fails, or an older one that answers late, leaves it as it was, or null where
 * the store has never answered.
 * @param {() => Promise<string[]>} load
 */
export function keepSeasonYears(load) {
  /** @type {string[] | null} */
  let kept = null;
  let started = 0;
  let keptRead = 0;
  return async () => {
    const read = ++started;
    try {
      const years = await load();
      if (read > keptRead) {
        kept = years;
        keptRead = read;
      }
    } catch {
      /* the store's last answer stands */
    }
    return kept;
  };
}

/** @param {HTMLElement} row */
const readListedYears = (row) =>
  [...row.querySelectorAll("option")].map(
    (option) => /** @type {HTMLOptionElement} */ (option).value,
  );

/**
 * Lists the seasons the store keeps, or, where it hasn't said, the ones the row lists as the page
 * last drew it, with the current one, and the shown one chosen.
 * @param {HTMLElement} row the picker's row, `#seasonRow`, whose select is `#seasonPicker`
 * @param {{ years: string[] | null, shownYear: number, currentYear: number | null }} seasons
 * @param {Pick<import("./league-words.js").LeagueWords, "seasonSpansYears">} words
 */
export function fillSeasonPicker(row, { years, shownYear, currentYear }, words) {
  const listed = listSeasonOptions(
    years ?? readListedYears(row),
    { shownYear, currentYear },
    words,
  );
  const options = listed.map(
    ({ year, name, isShown }) =>
      html`<option value="${year}" ${isShown ? "selected" : ""}>${name}</option>`,
  );
  setHtml(
    row,
    html`<span>Season</span>
      <select id="seasonPicker" class="select-field" aria-label="Season">
        ${options}
      </select>`,
  );
  row.hidden = listed.length < 2;
}

/**
 * Calls `pick` with each season picked, from the picker the row draws now or later.
 * @param {HTMLElement} row
 * @param {(year: number) => void} pick
 */
export function watchSeasonPicks(row, pick) {
  row.addEventListener("change", (event) =>
    pick(Number(/** @type {HTMLSelectElement} */ (event.target).value)),
  );
}
