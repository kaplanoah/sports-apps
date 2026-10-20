import { forgetWrittenMarkup, html, setHtml } from "./html.js";
import { nameSeason } from "./league-words.js";

// The settings' Season picker: the seasons the store keeps, or those it last listed, newest first,
// with the current one and the picked one always among them. It shows only once there's another
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
 * the picked one always among them.
 * @param {string[]} years
 * @param {{ pickedYear: number, currentYear: number | null }} seasons
 * @param {Pick<import("./league-words.js").LeagueWords, "seasonSpansYears">} words
 */
export function listSeasonOptions(years, { pickedYear, currentYear }, words) {
  const picked = String(pickedYear);
  const current = currentYear === null ? [] : [String(currentYear)];
  return [...new Set([picked, ...current, ...years])]
    .sort()
    .reverse()
    .map((year) => ({ year, name: nameSeason(Number(year), words), isPicked: year === picked }));
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
 * last drew it, with the current one, and the picked one chosen. Until the page knows a season to
 * pick, from the store or its last showing, it leaves the row as drawn, since the page never picks
 * a season by its own clock.
 * @param {HTMLElement} row the picker's row, `#seasonRow`, whose select is `#seasonPicker`
 * @param {{ years: string[] | null, pickedYear: number | null, currentYear: number | null }} seasons
 * @param {Pick<import("./league-words.js").LeagueWords, "seasonSpansYears">} words
 */
export function fillSeasonPicker(row, { years, pickedYear, currentYear }, words) {
  if (pickedYear === null) return;
  const listed = listSeasonOptions(
    years ?? readListedYears(row),
    { pickedYear, currentYear },
    words,
  );
  const options = listed.map(
    ({ year, name, isPicked }) =>
      html`<option value="${year}" ${isPicked ? "selected" : ""}>${name}</option>`,
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

// The picker's markup marks the season picked as it's picked, as its choice does, since the page
// saves the markup as it leaves the screen and a reload shows it before the page's code arrives.
/**
 * @param {HTMLElement} row
 * @param {string} year
 */
function markPicked(row, year) {
  const picker = row.querySelector("select");
  if (!picker) return;
  picker.value = year;
  for (const option of picker.options) option.defaultSelected = option.selected;
  forgetWrittenMarkup(row);
}

/** @param {HTMLSelectElement} picker */
const readMarkedYear = (picker) =>
  [...picker.options].find((option) => option.defaultSelected)?.value ?? picker.value;

/**
 * Calls `pick` with each season picked, from the picker the row draws now or later. A pick whose
 * season `pick` couldn't show, resolving false, puts the picker back on the season picked before,
 * so picking it again retries.
 * @param {HTMLElement} row
 * @param {(year: number) => Promise<boolean>} pick
 */
export function watchSeasonPicks(row, pick) {
  row.addEventListener("change", async (event) => {
    const picker = /** @type {HTMLSelectElement} */ (event.target);
    const before = readMarkedYear(picker);
    const year = picker.value;
    markPicked(row, year);
    if (await pick(Number(year))) return;
    if (row.querySelector("select")?.value === year) markPicked(row, before);
  });
}
