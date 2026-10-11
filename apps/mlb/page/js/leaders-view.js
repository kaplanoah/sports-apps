// A club's leaders on its sheet's Team section: who leads it in each of MLB's headline numbers this
// regular season, at the plate and on the mound, from the club's roster the store keeps. AVG, OPS,
// and ERA count only qualified players, as MLB's leaders do: 3.1 plate appearances for each of the
// club's games, or an inning for each. A number no one on the roster has yet shows no row. Each
// leader's name opens his sheet wherever his row is tapped.

import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderRetryNote } from "#shared/retry.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { countPlateAppearancesNeeded, hasInningsToQualify } from "./qualifying.js";
import {
  countOuts,
  formatInnings,
  renderPlayerCell,
  renderStatCells,
  renderStatTable,
} from "./stat-table.js";

/** @typedef {import("./roster-view.js").Roster} Roster */
/** @typedef {import("./roster-view.js").RosterPlayer} RosterPlayer */
/**
 * One of the club's leaders: the stat, the player, and his number as the row writes it.
 * @typedef {{ label: string, player: RosterPlayer, shown: string | number }} Leader
 */
/**
 * A number a club's leader leads it in: who can lead it, how it's measured, which way is best, and
 * how the row writes it.
 * @typedef {object} LeaderStat
 * @property {string} label
 * @property {(player: RosterPlayer, clubGames: number) => boolean} canLead
 * @property {(player: RosterPlayer) => number} measure
 * @property {(player: RosterPlayer) => string | number} write
 * @property {boolean} [isFewestFirst]
 */

const TITLE = "Leaders";
const NOTE = "Regular season";
const PLACEHOLDER_ROWS = 4;
/** @type {import("./stat-table.js").StatColumn[]} */
const COLUMNS = [["", (/** @type {Leader} */ leader) => leader.shown]];

/** @param {RosterPlayer} player */
const hasPlateAppearances = (player) => (player.hitting?.plateAppearances ?? 0) > 0;

/** @param {RosterPlayer} player */
const hasPitched = (player) => countOuts(player.pitching?.inningsPitched) > 0;

/**
 * @param {RosterPlayer} player
 * @param {number} clubGames
 */
const isQualifiedHitter = (player, clubGames) =>
  hasPlateAppearances(player) &&
  player.hitting.plateAppearances >= countPlateAppearancesNeeded(clubGames);

/**
 * @param {RosterPlayer} player
 * @param {number} clubGames
 */
const isQualifiedPitcher = (player, clubGames) =>
  hasPitched(player) && hasInningsToQualify(player.pitching.inningsPitched, clubGames);

/** @type {LeaderStat[]} */
const HITTING = [
  {
    label: "AVG",
    canLead: isQualifiedHitter,
    measure: (player) => Number(player.hitting.avg),
    write: (player) => player.hitting.avg,
  },
  {
    label: "OPS",
    canLead: isQualifiedHitter,
    measure: (player) => Number(player.hitting.ops),
    write: (player) => player.hitting.ops,
  },
  {
    label: "HR",
    canLead: hasPlateAppearances,
    measure: (player) => player.hitting.homeRuns ?? 0,
    write: (player) => player.hitting.homeRuns,
  },
  {
    label: "RBI",
    canLead: hasPlateAppearances,
    measure: (player) => player.hitting.rbi ?? 0,
    write: (player) => player.hitting.rbi,
  },
  {
    label: "SB",
    canLead: hasPlateAppearances,
    measure: (player) => player.hitting.stolenBases ?? 0,
    write: (player) => player.hitting.stolenBases,
  },
];

/** @type {LeaderStat[]} */
const PITCHING = [
  {
    label: "ERA",
    canLead: isQualifiedPitcher,
    measure: (player) => Number(player.pitching.era),
    write: (player) => player.pitching.era,
    isFewestFirst: true,
  },
  {
    label: "K",
    canLead: hasPitched,
    measure: (player) => player.pitching.strikeOuts ?? 0,
    write: (player) => player.pitching.strikeOuts,
  },
  {
    label: "IP",
    canLead: hasPitched,
    measure: (player) => countOuts(player.pitching.inningsPitched),
    write: (player) => formatInnings(player.pitching.inningsPitched),
  },
  {
    label: "SV",
    canLead: hasPitched,
    measure: (player) => player.pitching.saves ?? 0,
    write: (player) => player.pitching.saves,
  },
];

/**
 * The club's leader in a number, the first on the roster where two tie, or null while no one can
 * lead it or no one has any of a count yet.
 * @param {LeaderStat} stat
 * @param {RosterPlayer[]} players
 * @param {number} clubGames
 * @returns {Leader | null}
 */
function findLeader(stat, players, clubGames) {
  const candidates = players.filter((player) => stat.canLead(player, clubGames));
  if (!candidates.length) return null;
  const isBetter = (/** @type {number} */ value, /** @type {number} */ best) =>
    stat.isFewestFirst ? value < best : value > best;
  const leader = candidates.reduce((best, player) =>
    isBetter(stat.measure(player), stat.measure(best)) ? player : best,
  );
  if (!stat.isFewestFirst && stat.measure(leader) <= 0) return null;
  return { label: stat.label, player: leader, shown: stat.write(leader) };
}

/**
 * @param {Leader} leader
 * @param {string} club
 */
const renderLeaderRow = (leader, club) =>
  html`<tr>
    ${renderPlayerCell(leader.player, club, { lead: html`<span class="leader-stat">${leader.label}</span>` })}${renderStatCells(leader, COLUMNS)}
  </tr>`;

/**
 * A titled table of the club's leaders in a group of numbers, or nothing when it has none.
 * @param {string} title
 * @param {Leader[]} leaders
 * @param {string} club
 */
const renderGroup = (title, leaders, club) =>
  leaders.length > 0 &&
  renderStatTable(
    title,
    COLUMNS,
    leaders.map((leader) => renderLeaderRow(leader, club)),
    { opensRows: true },
  );

const renderPendingLeaders = () =>
  renderSheetPart(
    TITLE,
    html`<div class="leaders">
      ${renderStatTable(
        "Hitting",
        COLUMNS,
        Array.from(
          { length: PLACEHOLDER_ROWS },
          () =>
            html`<tr>
              <td class="team">${renderPlaceholder("AVG Freddie Freeman")}</td>
              <td>${renderPlaceholder(".000")}</td>
            </tr>`,
        ),
      )}
    </div>`,
    NOTE,
  );

/**
 * The club's leaders, or their shape while its roster loads, or why it didn't, or nothing when
 * the store keeps no roster for it, as for a past season, or its games aren't known.
 * @param {{ roster: Roster | null, clubGames: number | null, isLoading: boolean, failure?: import("#shared/retry.js").ReadFailure | null }} shown
 */
export function renderLeaders({ roster, clubGames, isLoading, failure }) {
  if (clubGames == null) return false;
  if (!roster) {
    if (isLoading) return renderPendingLeaders();
    return failure
      ? renderSheetPart(TITLE, renderRetryNote("Couldn't load the leaders", "sheet-message"))
      : false;
  }
  /** @param {LeaderStat[]} stats */
  const listLeaders = (stats) =>
    /** @type {Leader[]} */ (
      stats.map((stat) => findLeader(stat, roster.players, clubGames)).filter(Boolean)
    );
  const hitting = listLeaders(HITTING);
  const pitching = listLeaders(PITCHING);
  if (!hitting.length && !pitching.length) return false;
  return renderSheetPart(
    TITLE,
    html`<div class="leaders">
      ${renderGroup("Hitting", hitting, roster.club)}${renderGroup("Pitching", pitching, roster.club)}
    </div>`,
    NOTE,
  );
}
