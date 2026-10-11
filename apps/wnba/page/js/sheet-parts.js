import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { readWinShare } from "#shared/team-numbers.js";
import { renderClub } from "./clubs.js";

// The pieces the game sheet's views and a team's sheet share: how two sides of a measure are
// compared, which side leads it, and how far each side's bar reaches.

/**
 * The side whose number is better, or null for a tie or a missing number.
 * @param {number | null} away
 * @param {number | null} home
 * @param {{ isLowerBetter?: boolean }} [options]
 * @returns {"away" | "home" | null}
 */
export function findLeader(away, home, { isLowerBetter = false } = {}) {
  if (away == null || home == null || away === home) return null;
  return away > home !== isLowerBetter ? "away" : "home";
}

/**
 * A bar's reach, from 0 to 100, as a share of the larger of the two numbers.
 * @param {number} value
 * @param {number} most
 */
export const measureAgainst = (value, most) => (most > 0 ? Math.round((value / most) * 100) : 0);

/**
 * A row that compares two records, like 15-7, by the share of games each won. A side with no
 * record is left blank.
 * @param {import("#shared/html.js").Markup | string} label
 * @param {[string | null, string | null]} records
 * @returns {import("#shared/tape.js").TapeRow}
 */
export function describeRecords(label, records) {
  const shares = records.map(readWinShare);
  const describeSide = (index) => {
    const record = records[index];
    const share = shares[index];
    return record == null
      ? null
      : { value: record, bar: share == null ? null : Math.round(share * 100) };
  };
  return {
    label,
    away: describeSide(0),
    home: describeSide(1),
    leader: findLeader(shares[0], shares[1]),
  };
}

/**
 * A row that compares two numbers, each bar as long as its share of the larger. A side with no
 * number is left blank.
 * @param {import("#shared/html.js").Markup | string} label
 * @param {[number | null, number | null]} values
 * @param {{ format: (value: number) => string, isLowerBetter?: boolean }} options
 * @returns {import("#shared/tape.js").TapeRow}
 */
export function describeNumbers(label, values, { format, isLowerBetter = false }) {
  const reaches = values.map((value) => Math.max(value ?? 0, 0));
  const most = Math.max(...reaches);
  const describeSide = (index) => {
    const value = values[index];
    return value == null
      ? null
      : { value: format(value), bar: measureAgainst(reaches[index], most) };
  };
  return {
    label,
    away: describeSide(0),
    home: describeSide(1),
    leader: findLeader(values[0], values[1], { isLowerBetter }),
  };
}

/**
 * Which team is which above a tape, the away team left and the home team right.
 * @param {string} away
 * @param {string} home
 */
export const renderTapeTeams = (away, home) =>
  html`<div class="tape-teams">${renderClub(away)}${renderClub(home)}</div>`;

/** @param {string} text a line in place of a part's details */
export const renderSheetMessage = (text) => html`<p class="sheet-message">${text}</p>`;

/** @typedef {{ label: string, title: string }} PlayerColumn */

/**
 * Players' numbers in one table, a part for each team under its own heading row, so every team's
 * numbers take the same columns.
 * @param {{ heading: import("#shared/html.js").Markup | string, rows: import("#shared/html.js").Markup[] }[]} groups
 * @param {PlayerColumn[]} columns
 */
export const renderPlayerTable = (groups, columns) =>
  html`<table class="players tabular">
    ${groups.map(
      ({ heading, rows }) =>
        html`<tbody>
          <tr class="players-head">
            <th scope="col">${heading}</th>
            ${columns.map(
              (column) => html`<th scope="col" title="${column.title}">${column.label}</th>`,
            )}
          </tr>
          ${rows}
        </tbody>`,
    )}
  </table>`;

/**
 * Stand-ins for a players table's rows while they load.
 * @param {number} count how many rows
 * @param {number} columns how many numbers each row has after the player's name
 */
export const renderPendingPlayerRows = (count, columns) =>
  Array.from(
    { length: count },
    () =>
      html`<tr>
        <th scope="row">${renderPlaceholder("Firstname Lastname")}</th>
        ${Array.from({ length: columns }, () => html`<td>${renderPlaceholder("00")}</td>`)}
      </tr>`,
  );
