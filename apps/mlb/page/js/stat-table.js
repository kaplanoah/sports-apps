// The tables of players' numbers on the sheets, like a box score's batters or a roster's bullpen:
// a column of names under a label, then a column for each number.

import { html } from "#shared/html.js";
import { renderPlayerButton } from "./player-button.js";

/** @typedef {import("#shared/html.js").Markup} Markup */
/**
 * A column's label and the number it shows from a row, by field or as read from the row.
 * @typedef {readonly [string, string | ((row: any) => Markup | string | number | null | undefined)]} StatColumn
 */

/**
 * Innings as the sheets write them. MLB counts them in thirds after the point: 5.2 is five and two
 * thirds, and 0.2 just two thirds.
 * @param {string | number} innings
 */
export function formatInnings(innings) {
  const [whole, thirds] = String(innings).split(".");
  if (!thirds || thirds === "0") return whole;
  return whole === "0" ? `${thirds}/3` : `${whole} ${thirds}/3`;
}

/**
 * Innings as the outs they hold, as MLB writes them: 5.2 is seventeen.
 * @param {string | number | null | undefined} innings
 */
export const countOuts = (innings) => {
  const [whole, thirds] = String(innings ?? "0").split(".");
  return Number(whole) * 3 + Number(thirds ?? 0);
};

/**
 * A pitcher's line in one game as the sheets write it, like "6 IP, 94 P, 3 R, 6 K", in the box
 * score's order, without his pitches where they weren't kept.
 * @param {{ innings: string | number, pitches?: number | null, runs: number, strikeOuts: number }} line
 */
export const describeGamePitching = ({ innings, pitches, runs, strikeOuts }) =>
  [
    `${formatInnings(innings)} IP`,
    pitches != null ? `${pitches} P` : null,
    `${runs} R`,
    `${strikeOuts} K`,
  ]
    .filter(Boolean)
    .join(", ");

// What a stat shows where there's no number for it.
export const NO_NUMBER = "-";

/**
 * @param {any} row
 * @param {StatColumn[1]} reader
 */
const readValue = (row, reader) => (typeof reader === "function" ? reader(row) : row[reader]);

/**
 * A row's numbers, with a dash for one it hasn't any of.
 * @param {any} row
 * @param {readonly StatColumn[]} columns
 */
export const renderStatCells = (row, columns) =>
  columns.map(
    ([, reader]) => html`<td class="tabular">${readValue(row, reader) ?? NO_NUMBER}</td>`,
  );

/**
 * A player's name cell, with what goes before his name, like his number, and after it, like his
 * position. His name is the button that opens his sheet wherever the row is tapped, but for a
 * player kept without his id, whose name shows plainly.
 * @param {{ id?: number, name: string, number?: string }} player
 * @param {string} club
 * @param {{ lead?: Markup | string, note?: Markup | string, isPlayingNow?: boolean }} [beside]
 */
export const renderPlayerCell = (
  player,
  club,
  { lead = "", note = "", isPlayingNow = false } = {},
) =>
  player.id
    ? html`<td class="team row-button-cell">${lead}${renderPlayerButton(/** @type {{ id: number, name: string }} */ (player), club, { isPlayingNow })}${note}</td>`
    : html`<td class="team">${lead}<span class="box-name">${player.name}</span>${note}</td>`;

/**
 * A table whose rows each open wherever they're tapped clips the button that reaches over each
 * row to the table's sides (row-button.css).
 * @param {string} label
 * @param {readonly StatColumn[]} columns
 * @param {Markup[]} rows
 * @param {{ opensRows?: boolean }} [options]
 */
export const renderStatTable = (label, columns, rows, { opensRows = false } = {}) =>
  html`<div class="box-wrap">
    <div class="${opensRows ? "row-button-clip" : ""}">
      <table class="st box-table">
        <thead>
          <tr>
            <th class="left">${label}</th>
            ${columns.map(([heading]) => html`<th>${heading}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>`;
