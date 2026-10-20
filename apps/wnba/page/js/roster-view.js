// A team's roster, in the Roster section of its team's sheet: each player's number and name, then
// her position, height, where she came from, age, and first WNBA season, then her averages a game
// this season, which the section scrolls across to while her number and name stay put. The number
// and name are a table of their own beside the rest's, so they stay put as one box rather than a
// box for each cell. A tap on a column's name sorts by it.

import { html, joinWithSeparator } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderRetryBlock } from "#shared/retry.js";
import { renderPlayerButton } from "./player-button.js";
import { formatAverage } from "./team-view.js";

/** @typedef {import("#shared/html.js").Markup} Markup */
/** @typedef {{ reason: string | null, isForSeason: boolean, sentence: string | null, updated: string | null }} OutReason */
/** @typedef {{ id: string, number: string | null, firstName: string, lastName: string, position: string | null, height: string | null, age: number | null, college: string | null, country: string | null, out: OutReason | null, debut: number | null }} RosterPlayer */
/** @typedef {{ id: number, team: string, firstName: string, lastName: string, games: number, minutes: number, points: number, rebounds: number, assists: number }} Averages */
/** @typedef {RosterPlayer & { averages: Averages | null }} RosterRow */
/** @typedef {{ team: string, season: number, coach: string | null, players: RosterPlayer[] }} Roster */
/** @typedef {{ key: string, isDescending: boolean }} RosterSort */
/** @typedef {{ key: string, label: string, title?: string, className?: string, read: (row: RosterRow) => Markup | string | number, sortValue: (row: RosterRow) => string | number | null, isStat?: boolean }} RosterColumn */

/** @type {RosterSort} */
export const DEFAULT_SORT = { key: "name", isDescending: false };

const PENDING_ROWS = 12;

const NONE = html`<span class="roster-none">-</span>`;

/**
 * Each player on the roster beside her averages that season, or null for one who hasn't played.
 * A player who changed teams has her whole season's averages on each team's roster.
 * @param {RosterPlayer[]} players
 * @param {Averages[]} averages every player's in the league
 * @returns {RosterRow[]}
 */
export function matchAverages(players, averages) {
  const byId = new Map(averages.map((each) => [String(each.id), each]));
  return players.map((player) => ({ ...player, averages: byId.get(player.id) ?? null }));
}

/** @param {string | null} height as 6'4" */
function readInches(height) {
  const [feet, inches] = (height?.match(/\d+/g) ?? []).map(Number);
  return feet === undefined ? null : feet * 12 + (inches ?? 0);
}

/** @param {RosterRow} row */
const readHome = (row) => row.college ?? row.country;

/** @param {RosterRow} row */
function renderHome(row) {
  if (row.college) return row.college;
  return row.country ? html`<span class="roster-country">${row.country}</span>` : NONE;
}

/** @param {string | number | null} value */
const showValue = (value) => value ?? NONE;

/**
 * One of the season's averages, a whole number for games and to a tenth for the rest.
 * @param {string} key
 * @param {string} label
 * @param {string} title
 */
function describeStat(key, label, title) {
  /** @param {RosterRow} row */
  const sortValue = (row) => row.averages?.[key] ?? null;
  return {
    key,
    label,
    title,
    isStat: true,
    sortValue,
    /** @param {RosterRow} row */
    read: (row) => {
      const value = sortValue(row);
      if (value === null) return NONE;
      return key === "games" ? String(value) : formatAverage(value);
    },
  };
}

/** @type {RosterColumn[]} */
const BIO_COLUMNS = [
  {
    key: "position",
    label: "Pos",
    title: "Position",
    read: (row) => showValue(row.position),
    sortValue: (row) => row.position,
  },
  {
    key: "height",
    label: "Ht",
    title: "Height",
    read: (row) => showValue(row.height),
    sortValue: (row) => readInches(row.height),
  },
  {
    key: "home",
    label: "From",
    title: "College, or country for a player who skipped college",
    className: "roster-text",
    read: renderHome,
    sortValue: readHome,
  },
  { key: "age", label: "Age", read: (row) => showValue(row.age), sortValue: (row) => row.age },
  {
    key: "debut",
    label: "Debut",
    title: "First WNBA season",
    read: (row) => showValue(row.debut),
    sortValue: (row) => row.debut,
  },
];

/** @type {RosterColumn[]} */
const STAT_COLUMNS = [
  describeStat("games", "GP", "Games played"),
  describeStat("minutes", "Min", "Minutes per game"),
  describeStat("points", "Pts", "Points per game"),
  describeStat("rebounds", "Reb", "Rebounds per game"),
  describeStat("assists", "Ast", "Assists per game"),
];

/** @type {RosterColumn} */
const NUMBER_COLUMN = {
  key: "number",
  label: "#",
  title: "Number",
  read: (row) => row.number ?? "",
  sortValue: (row) => (row.number === null ? null : Number(row.number)),
};

/** @type {RosterColumn} */
const NAME_COLUMN = {
  key: "name",
  label: "Player",
  read: (row) => row.lastName,
  sortValue: (row) => `${row.lastName} ${row.firstName}`,
};

const FACT_COLUMNS = [...BIO_COLUMNS, ...STAT_COLUMNS];

const COLUMNS = [NUMBER_COLUMN, NAME_COLUMN, ...FACT_COLUMNS];

/** @param {string} key */
const findColumn = (key) => COLUMNS.find((column) => column.key === key) ?? NAME_COLUMN;

/**
 * The sort a tap on a column's name makes: the same column reversed, or a new one with the most
 * first for an average and A to Z or the least first for the rest.
 * @param {RosterSort} sort
 * @param {string} key
 * @returns {RosterSort}
 */
export function chooseSort(sort, key) {
  if (sort.key === key) return { key, isDescending: !sort.isDescending };
  return { key, isDescending: !!findColumn(key).isStat };
}

/**
 * @param {string | number} first
 * @param {string | number} second
 */
const compareValues = (first, second) =>
  typeof first === "number" && typeof second === "number"
    ? first - second
    : String(first).localeCompare(String(second));

/**
 * The rows in the sort's order, those without a value for its column last either way, and ties
 * by name.
 * @param {RosterRow[]} rows
 * @param {RosterSort} sort
 */
export function sortRows(rows, sort) {
  const { sortValue } = findColumn(sort.key);
  const direction = sort.isDescending ? -1 : 1;
  return [...rows].sort((first, second) => {
    const [a, b] = [sortValue(first), sortValue(second)];
    if ((a === null) !== (b === null)) return a === null ? 1 : -1;
    const order = a === null || b === null ? 0 : direction * compareValues(a, b);
    return (
      order ||
      compareValues(NAME_COLUMN.sortValue(first) ?? "", NAME_COLUMN.sortValue(second) ?? "")
    );
  });
}

// Phosphor's caret-down, at its Regular weight.
const SORT_ICON = html`<svg class="roster-caret" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"
  />
</svg>`;

/**
 * A cell's class attribute, or none for a plain one.
 * @param {RosterColumn} column
 * @param {string} [className]
 */
function renderClass(column, className = "") {
  const classes = [
    column.className,
    column.isStat && "roster-stat",
    column === STAT_COLUMNS[0] && "roster-season-start",
    className,
  ].filter(Boolean);
  return classes.length > 0 && html` class="${classes.join(" ")}"`;
}

/**
 * A column's name, a button that sorts by it, marked as the sort when it is.
 * @param {RosterColumn} column
 * @param {RosterSort} sort
 * @param {string} [className]
 */
function renderHeading(column, sort, className = "") {
  const order = sort.key === column.key && (sort.isDescending ? "descending" : "ascending");
  return html`<th scope="col"${renderClass(column, className)}${column.title && html` title="${column.title}"`}${order && html` aria-sort="${order}"`}>
    <button type="button" class="roster-sort" data-sort="${column.key}">${column.label}${SORT_ICON}</button>
  </th>`;
}

/** @param {RosterSort} sort */
const renderPinnedHead = (sort) =>
  html`<thead>
    <tr class="roster-bands">
      <th class="roster-number"></th>
      <th class="roster-player"></th>
    </tr>
    <tr class="roster-head">
      ${renderHeading(NUMBER_COLUMN, sort, "roster-number")}${renderHeading(NAME_COLUMN, sort, "roster-player")}
    </tr>
  </thead>`;

/** @param {RosterSort} sort */
const renderFactsHead = (sort) =>
  html`<thead>
    <tr class="roster-bands">
      <th colspan="${BIO_COLUMNS.length}"></th>
      <th colspan="${STAT_COLUMNS.length}" class="roster-band roster-season-start" scope="colgroup">Per game</th>
    </tr>
    <tr class="roster-head">
      ${FACT_COLUMNS.map((column) => renderHeading(column, sort))}
    </tr>
  </thead>`;

/** @param {RosterRow} row */
const identifyNameCell = (row) => `rosterName-${row.id}`;

const OUT_CHIP = html`<span class="foul-chip"><span class="foul-chip-words">Out</span></span>`;

/**
 * @param {RosterRow} row
 * @param {string} team
 * @param {boolean} showsOut whether the Out chip shows, as it does only while the team still plays
 */
const renderPinnedRow = (row, team, showsOut) =>
  html`<tr data-key="${row.id}" data-player-row="${row.id}">
    <td class="roster-number">${NUMBER_COLUMN.read(row)}</td>
    <th scope="row" class="roster-player" id="${identifyNameCell(row)}">
      ${renderPlayerButton(
        { ...row, team },
        html`<span class="roster-first">${row.firstName}</span>
          <span class="roster-last">${row.lastName}${showsOut && row.out && OUT_CHIP}</span>`,
      )}
    </th>
  </tr>`;

// A row of facts is named by its player's name in the pinned table, its row header across the way.
/** @param {RosterRow} row */
const renderFactsRow = (row) =>
  html`<tr data-key="${row.id}:facts" data-player-row="${row.id}" aria-labelledby="${identifyNameCell(row)}">
    ${FACT_COLUMNS.map((column) => html`<td${renderClass(column)}>${column.read(row)}</td>`)}
  </tr>`;

const renderPendingPinnedRow = () =>
  html`<tr>
    <td class="roster-number">${renderPlaceholder("00")}</td>
    <th scope="row" class="roster-player">
      <span class="roster-first">${renderPlaceholder("First")}</span>
      <span class="roster-last">${renderPlaceholder("Lastname")}</span>
    </th>
  </tr>`;

const renderPendingFactsRow = () =>
  html`<tr>
    ${FACT_COLUMNS.map((column) => html`<td${renderClass(column)}>${renderPlaceholder("00")}</td>`)}
  </tr>`;

/**
 * The pinned table of numbers and names beside the table of facts and averages, row for row.
 * @param {{ pinnedRows: Markup[], factsRows: Markup[], sort: RosterSort }} tables
 */
const renderTables = ({ pinnedRows, factsRows, sort }) =>
  html`<div class="roster-tables">
    <table class="roster roster-pinned tabular">
      ${renderPinnedHead(sort)}
      <tbody>
        ${pinnedRows}
      </tbody>
    </table>
    <table class="roster roster-facts tabular">
      ${renderFactsHead(sort)}
      <tbody>
        ${factsRows}
      </tbody>
    </table>
  </div>`;

/** @param {RosterSort} sort */
const renderPendingTables = (sort) =>
  renderTables({
    pinnedRows: Array.from({ length: PENDING_ROWS }, renderPendingPinnedRow),
    factsRows: Array.from({ length: PENDING_ROWS }, renderPendingFactsRow),
    sort,
  });

/** @param {string | null} coach */
const renderCoach = (coach) =>
  coach &&
  html`<dl class="roster-coach">
    <dt>Head coach</dt>
    <dd>${coach}</dd>
  </dl>`;

/**
 * The roster's table and its head coach, or stand-ins for them while they load, or why they
 * didn't.
 * @param {{ roster: Roster | null, averages: Averages[], sort: RosterSort, isLoading: boolean, failure?: import("#shared/retry.js").ReadFailure | null, showsOut: boolean }} shown
 *   `showsOut` says whether a player out shows so, as she does only while her team still plays
 */
export function renderRoster({ roster, averages, sort, isLoading, failure, showsOut }) {
  if (!roster && isLoading) return renderPendingTables(sort);
  if (!roster) return renderRetryBlock("roster", failure ?? "unreachable");
  const rows = sortRows(matchAverages(roster.players, averages), sort);
  return html`${renderTables({
    pinnedRows: rows.map((row) => renderPinnedRow(row, roster.team, showsOut)),
    factsRows: rows.map(renderFactsRow),
    sort,
  })}${renderCoach(roster.coach)}`;
}

/**
 * What the roster says above its table: the season, and how many players it has once it's loaded.
 * @param {Roster | null} roster
 * @param {number} year
 */
export const describeRosterNote = (roster, year) =>
  joinWithSeparator(roster ? [String(year), `${roster.players.length} players`] : [String(year)]);
