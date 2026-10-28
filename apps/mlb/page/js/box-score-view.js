// The Game section's box score, below the game's row and its starters: before first pitch, each
// club's lineup once it's posted, with each batter's season so far; once the game starts, how each
// club has scored and who's on base (runs-view.js), its runs by inning, then each club's batters
// and pitchers.

import { html } from "#shared/html.js";
import { isPlayingNow } from "#shared/playing-now.js";
import { renderPlainClub, renderTeamDot } from "./clubs.js";
import { renderRuns } from "./runs-view.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { formatInnings, renderPlayerCell, renderStatCells, renderStatTable } from "./stat-table.js";

const SIDES = /** @type {const} */ (["away", "home"]);
const INNINGS = 9;
const BATTING_COLUMNS = /** @type {const} */ ([
  ["AB", "atBats"],
  ["R", "runs"],
  ["H", "hits"],
  ["RBI", "rbi"],
  ["BB", "walks"],
  ["K", "strikeOuts"],
]);
const PITCHING_COLUMNS = /** @type {const} */ ([
  [
    "IP",
    (/** @type {any} */ pitcher) =>
      pitcher.inningsPitched == null ? null : formatInnings(pitcher.inningsPitched),
  ],
  ["P", "pitches"],
  ["H", "hits"],
  ["R", "runs"],
  ["ER", "earnedRuns"],
  ["BB", "walks"],
  ["K", "strikeOuts"],
]);
const LINEUP_COLUMNS = /** @type {const} */ ([
  ["AVG", "average"],
  ["HR", "homeRuns"],
  ["RBI", "rbi"],
]);

/** @typedef {{ away: string, home: string, state?: string, today?: boolean }} BoxScoreGame */

/** @param {any} batter */
const renderPosition = (batter) => html`<span class="box-pos">${batter.position}</span>`;

/**
 * The club's total in each column, or none where a batter has none of it, as his own row shows.
 * @param {any[]} batters
 */
const sumBatting = (batters) =>
  Object.fromEntries(
    BATTING_COLUMNS.map(([, field]) => [
      field,
      batters.every((batter) => Number.isFinite(batter[field]))
        ? batters.reduce((total, batter) => total + batter[field], 0)
        : null,
    ]),
  );

/**
 * @param {any[]} batters
 * @param {string} club
 * @param {boolean} isPlayingNow whether the game's players are playing now
 */
const renderBatting = (batters, club, isPlayingNow) =>
  renderStatTable(
    "Batters",
    BATTING_COLUMNS,
    [
      ...batters.map(
        (batter) =>
          html`<tr class="${batter.isSub ? "box-sub" : ""}">
            ${renderPlayerCell(batter, club, { note: renderPosition(batter), isPlayingNow })}${renderStatCells(batter, BATTING_COLUMNS)}
          </tr>`,
      ),
      html`<tr class="box-total">
        <td class="team">Team</td>
        ${renderStatCells(sumBatting(batters), BATTING_COLUMNS)}
      </tr>`,
    ],
    { opensRows: true },
  );

/** @param {any} pitcher */
const renderDecision = (pitcher) =>
  pitcher.decision ? html`<span class="box-decision">${pitcher.decision}</span>` : "";

/**
 * @param {any[]} pitchers
 * @param {string} club
 * @param {boolean} isPlayingNow whether the game's players are playing now
 */
const renderPitching = (pitchers, club, isPlayingNow) =>
  renderStatTable(
    "Pitchers",
    PITCHING_COLUMNS,
    pitchers.map(
      (pitcher) =>
        html`<tr>
          ${renderPlayerCell(pitcher, club, { note: renderDecision(pitcher), isPlayingNow })}${renderStatCells(pitcher, PITCHING_COLUMNS)}
        </tr>`,
    ),
    { opensRows: true },
  );

/**
 * @param {any[]} batters
 * @param {string} club
 */
const renderLineup = (batters, club) =>
  renderStatTable(
    "Batters",
    LINEUP_COLUMNS,
    batters.map(
      (batter) =>
        html`<tr>
          ${renderPlayerCell(batter, club, { note: renderPosition(batter) })}${renderStatCells(batter, LINEUP_COLUMNS)}
        </tr>`,
    ),
    { opensRows: true },
  );

/**
 * A half inning's runs. A home club that leads after the top of the ninth or later never bats in
 * the bottom.
 * @param {any} boxScore
 * @param {"away" | "home"} side
 * @param {number} index
 */
function describeInningRuns(boxScore, side, index) {
  const runs = boxScore.innings[index]?.[side];
  if (runs !== null && runs !== undefined) return String(runs);
  const isUnplayedBottom =
    boxScore.state === "final" && side === "home" && index === boxScore.innings.length - 1;
  return isUnplayedBottom ? "x" : "";
}

/**
 * @param {BoxScoreGame} game
 * @param {any} boxScore
 */
function renderInnings(game, boxScore) {
  const count = Math.max(INNINGS, boxScore.innings.length);
  const numbers = Array.from({ length: count }, (_, index) => index + 1);
  const rows = SIDES.map((side) => {
    const totals = boxScore.totals[side];
    return html`<tr>
      <td class="team"><span class="club">${renderTeamDot(game[side])}<span class="team-name">${game[side]}</span></span></td>
      ${numbers.map((number) => html`<td class="mid tabular">${describeInningRuns(boxScore, side, number - 1)}</td>`)}
      <td class="mid tabular total">${totals.runs}</td>
      <td class="mid tabular">${totals.hits}</td>
      <td class="mid tabular">${totals.errors}</td>
    </tr>`;
  });
  return renderSheetPart(
    "Innings",
    html`<div class="box-wrap">
      <table class="st line-score">
        <thead>
          <tr>
            <td class="left"></td>
            ${numbers.map((number) => html`<th class="mid">${number}</th>`)}
            <th class="mid total">R</th>
            <th class="mid">H</th>
            <th class="mid">E</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`,
  );
}

/**
 * @param {BoxScoreGame} game
 * @param {any} boxScore
 */
const renderClubs = (game, boxScore) => {
  // A box score lists only the batters and pitchers who have played in its game.
  const isPlaying = isPlayingNow(game.state, !!game.today);
  return SIDES.map((side) =>
    renderSheetPart(
      renderPlainClub(game[side]),
      html`${renderBatting(boxScore[side].batters, game[side], isPlaying)}${renderPitching(boxScore[side].pitchers, game[side], isPlaying)}`,
    ),
  );
};

/**
 * @param {BoxScoreGame} game
 * @param {any} boxScore
 */
const renderLineups = (game, boxScore) =>
  SIDES.filter((side) => boxScore[side].batters.length).map((side) =>
    renderSheetPart(
      renderPlainClub(game[side]),
      renderLineup(boxScore[side].batters, game[side]),
      "Lineup",
    ),
  );

/**
 * @param {BoxScoreGame} game
 * @param {any} boxScore the Worker's, or null while it hasn't answered
 */
export function renderBoxScore(game, boxScore) {
  if (!boxScore) return html``;
  if (boxScore.state === "pre") return html`${renderLineups(game, boxScore)}`;
  return html`${renderRuns(game, boxScore)}${renderInnings(game, boxScore)}${renderClubs(game, boxScore)}`;
}
