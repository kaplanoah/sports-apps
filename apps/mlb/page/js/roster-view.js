// The Roster section of a club's sheet: its hitters, most plate appearances first, its starters,
// most starts first, and its bullpen, most innings first, each with his regular season so far,
// then who is on the injured list. A two-way player is with the hitters and the pitchers.

import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderRetryBlock } from "#shared/retry.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderPlayerButton } from "./player-button.js";
import {
  countOuts,
  formatInnings,
  renderPlayerCell,
  renderStatCells,
  renderStatTable,
} from "./stat-table.js";

/** @typedef {import("./stat-table.js").StatColumn} StatColumn */
/**
 * A club's roster as the store keeps it.
 * @typedef {{ club: string, season: number, players: RosterPlayer[] }} Roster
 * @typedef {{ id: number, name: string, number: string, position: string, injury: string | null, hitting?: any, pitching?: any }} RosterPlayer
 */

const PITCHER = "P";
const TWO_WAY = "TWP";
const PLACEHOLDER_ROWS = 5;

/** @type {StatColumn[]} */
const HITTER_COLUMNS = [
  ["AVG", (player) => player.hitting?.avg],
  ["HR", (player) => player.hitting?.homeRuns],
  ["RBI", (player) => player.hitting?.rbi],
  ["OPS", (player) => player.hitting?.ops],
];
/** @type {StatColumn} */
const INNINGS_COLUMN = [
  "IP",
  (player) => player.pitching?.inningsPitched && formatInnings(player.pitching.inningsPitched),
];
/** @type {StatColumn[]} */
const STARTER_COLUMNS = [
  ["ERA", (player) => player.pitching?.era],
  ["W-L", (player) => player.pitching && `${player.pitching.wins}-${player.pitching.losses}`],
  INNINGS_COLUMN,
  ["K", (player) => player.pitching?.strikeOuts],
];
/** @type {StatColumn[]} */
const BULLPEN_COLUMNS = [
  ["ERA", (player) => player.pitching?.era],
  ["SV", (player) => player.pitching?.saves],
  INNINGS_COLUMN,
  ["K", (player) => player.pitching?.strikeOuts],
];

/** @param {RosterPlayer} player */
const isPitcher = (player) => player.position === PITCHER || player.position === TWO_WAY;

/** @param {RosterPlayer} player */
const isHitter = (player) => player.position !== PITCHER;

/**
 * A pitcher who has started at least half the games he has pitched in.
 * @param {RosterPlayer} player
 */
const isStarter = (player) =>
  (player.pitching?.gamesStarted ?? 0) > 0 &&
  player.pitching.gamesStarted * 2 >= player.pitching.gamesPlayed;

/**
 * @param {RosterPlayer[]} players
 * @param {(player: RosterPlayer) => number} measure
 */
const sortByMost = (players, measure) =>
  [...players].sort((first, second) => measure(second) - measure(first));

/**
 * A player's row, which opens his sheet wherever it's tapped.
 * @param {RosterPlayer} player
 * @param {string} club
 * @param {string} tag what the row says beside his name
 * @param {readonly StatColumn[]} columns
 */
const renderPlayerRow = (player, club, tag, columns) =>
  html`<tr>
    ${renderPlayerCell(player, club, {
      lead: html`<span class="roster-number tabular">${player.number}</span>`,
      note: html`<span class="box-pos">${tag}</span>`,
    })}${renderStatCells(player, columns)}
  </tr>`;

/**
 * A titled table of players, or nothing when there are none.
 * @param {string} title
 * @param {{ club: string, players: RosterPlayer[] }} group
 * @param {readonly StatColumn[]} columns
 * @param {(player: RosterPlayer) => string} tag
 */
const renderGroup = (title, { club, players }, columns, tag) =>
  players.length
    ? renderSheetPart(
        title,
        renderStatTable(
          "Name",
          columns,
          players.map((player) => renderPlayerRow(player, club, tag(player), columns)),
          { opensRows: true },
        ),
      )
    : html``;

/**
 * @param {string} club
 * @param {RosterPlayer[]} injured
 */
const renderInjuredList = (club, injured) =>
  injured.length
    ? renderSheetPart(
        "Injured list",
        html`<ul class="injured-list">
          ${injured.map(
            (player) =>
              html`<li>
                ${renderPlayerButton(player, club)}<span class="box-pos">${player.position}</span
                ><span class="injured-status">${player.injury}</span>
              </li>`,
          )}
        </ul>`,
      )
    : html``;

/** The shape of a roster while it loads. */
const renderPendingRoster = () =>
  renderSheetPart(
    "Hitters",
    renderStatTable(
      "Name",
      HITTER_COLUMNS,
      Array.from(
        { length: PLACEHOLDER_ROWS },
        () =>
          html`<tr>
            <td class="team">${renderPlaceholder("00 Steven Kwan")}</td>${HITTER_COLUMNS.map(
              () => html`<td>${renderPlaceholder(".000")}</td>`,
            )}
          </tr>`,
      ),
    ),
  );

/**
 * @param {Roster | null} roster the store's, or null while it hasn't answered
 * @param {{ isLoading: boolean, failure?: import("#shared/retry.js").ReadFailure | null }} state
 */
export function renderRoster(roster, { isLoading, failure }) {
  if (!roster) {
    return isLoading ? renderPendingRoster() : renderRetryBlock("roster", failure ?? "unreachable");
  }
  const active = roster.players.filter((player) => !player.injury);
  const pitchers = active.filter(isPitcher);
  const hitters = sortByMost(
    active.filter(isHitter),
    (player) => player.hitting?.plateAppearances ?? 0,
  );
  const starters = sortByMost(pitchers.filter(isStarter), (player) => player.pitching.gamesStarted);
  const bullpen = sortByMost(
    pitchers.filter((player) => !isStarter(player)),
    (player) => countOuts(player.pitching?.inningsPitched),
  );
  const { club } = roster;
  return html`${renderGroup("Hitters", { club, players: hitters }, HITTER_COLUMNS, (player) => player.position)}
    ${renderGroup("Starters", { club, players: starters }, STARTER_COLUMNS, () => "SP")}
    ${renderGroup("Bullpen", { club, players: bullpen }, BULLPEN_COLUMNS, () => "RP")}
    ${renderInjuredList(
      club,
      roster.players.filter((player) => player.injury),
    )}`;
}
