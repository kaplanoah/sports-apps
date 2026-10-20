import { capitalize, html } from "#shared/html.js";
import { namePeriod, OVERTIME_SECONDS, QUARTER_SECONDS, REGULATION_PERIODS } from "./periods.js";
import { nameTeam } from "./series.js";

// The game sheet's chart of the lead through a game: the visitors' lead above the middle line and
// the home team's below it, in the order the box score above it lists them, after each basket, on
// a tile with each team named just outside its own half and each side's biggest lead marked, each
// side in its team's color, which the game sheet sets. A live game's line stops at its latest
// basket. The chart's words are laid over the drawing rather than drawn in it, so they keep their
// type role's size however wide it shows.

/** @typedef {{ periods: number, isOver: boolean, scores: [number, number, number][] }} Lead each score's seconds from tip-off, then the away and home scores */

const WIDTH = 320;
const LEFT = 30;
const RIGHT = 6;
// The tile reaches past the scale's dashed edges, so a biggest lead near one keeps its label inside.
const TILE_ROOM = 10;
const PLOT_HEIGHT = 102;
const TOP = TILE_ROOM;
const MIDDLE = TOP + PLOT_HEIGHT / 2;
const HEIGHT = TOP + PLOT_HEIGHT + TILE_ROOM;
const STEP = 5;
const SMALLEST_REACH = 10;
// From a biggest lead's dot to the tile's edge: the dot, the label beyond it, and a gap.
const PEAK_ROOM = 24;
const TICK_HALF = 3;

/** @param {number} periods */
const measureGame = (periods) =>
  REGULATION_PERIODS * QUARTER_SECONDS +
  Math.max(0, periods - REGULATION_PERIODS) * OVERTIME_SECONDS;

/** @param {number} index */
const measurePeriodStart = (index) =>
  Math.min(index, REGULATION_PERIODS) * QUARTER_SECONDS +
  Math.max(0, index - REGULATION_PERIODS) * OVERTIME_SECONDS;

/** @param {number} value */
const formatCoordinate = (value) => String(Math.round(value * 10) / 10);

/**
 * The biggest lead each side had, and when, the visitors' as a positive margin and the home
 * team's as a negative one.
 * @param {{ at: number, margin: number }[]} margins
 * @param {1 | -1} sign
 */
function findBiggestLead(margins, sign) {
  return margins.reduce(
    (best, point) => (point.margin * sign > best.margin * sign ? point : best),
    { at: 0, margin: 0 },
  );
}

/** @param {Lead} lead */
const listMargins = (lead) => lead.scores.map(([at, away, home]) => ({ at, margin: away - home }));

/**
 * The biggest lead each side had, as the chart marks them, each as the points it led by, so the
 * box score's Biggest lead says what the chart shows.
 * @param {Lead} lead
 */
export function measureBiggestLeads(lead) {
  const margins = listMargins(lead);
  return {
    away: findBiggestLead(margins, 1).margin,
    home: -findBiggestLead(margins, -1).margin,
  };
}

/**
 * @param {string} name
 * @param {number} margin
 */
const describeBiggestLead = (name, margin) =>
  margin > 0 ? `the ${name} led by as many as ${margin}` : `the ${name} never led`;

/**
 * The scale's reach, in points either way: the biggest lead rounded up to a step, and a step more
 * while that leaves its dot and label too near the tile's edge.
 * @param {number} biggest
 */
function chooseReach(biggest) {
  let reach = Math.max(SMALLEST_REACH, Math.ceil(biggest / STEP) * STEP);
  while (((reach - biggest) / reach) * (PLOT_HEIGHT / 2) + TILE_ROOM < PEAK_ROOM) reach += STEP;
  return reach;
}

/**
 * The lead holds until the next basket, so the line steps.
 * @param {{ at: number, margin: number }[]} margins
 * @param {number} end
 */
function traceSteps(margins, end) {
  const steps = margins.flatMap((point, index) =>
    index
      ? [
          [point.at, margins[index - 1].margin],
          [point.at, point.margin],
        ]
      : [[point.at, point.margin]],
  );
  steps.push([end, margins[margins.length - 1].margin]);
  return steps;
}

/** @param {number} value a share from 0 to 1 */
const formatShare = (value) => `${Math.round(value * 1000) / 10}%`;

/** @param {number} x across the drawing */
const formatAcross = (x) => formatShare(x / WIDTH);

/** @param {number} y down the drawing */
const formatDown = (y) => formatShare(y / HEIGHT);

const PLOT_EDGES = `--plot-left: ${formatAcross(LEFT)}; --plot-right: ${formatAcross(RIGHT)}`;

/**
 * Each team's name, outside its own half, and the plot between them, with the periods under it.
 * @param {{ away: string, home: string }} teams
 * @param {import("#shared/html.js").Markup} plot
 * @param {import("#shared/html.js").Markup[]} periodNames
 */
const renderChartFrame = (teams, plot, periodNames) =>
  html`<div class="lead-chart" style="${PLOT_EDGES}">
    <p class="lead-side away" aria-hidden="true">&#9650; ${nameTeam(teams.away)} ahead</p>
    <div class="lead-plot">${plot}</div>
    <p class="lead-side home" aria-hidden="true">&#9660; ${nameTeam(teams.home)} ahead</p>
    <div class="lead-periods" aria-hidden="true">${periodNames}</div>
  </div>`;

/**
 * @param {number} periods
 * @param {(at: number) => number} x
 */
function renderPeriodNames(periods, x) {
  return [...Array(periods).keys()].map((index) => {
    const middle = (measurePeriodStart(index) + measurePeriodStart(index + 1)) / 2;
    return html`<span class="lead-period" style="--x: ${formatAcross(x(middle))}">${namePeriod(index + 1)}</span>`;
  });
}

/** @param {number} periods */
const placeAcross = (periods) => (/** @type {number} */ at) =>
  LEFT + (at / measureGame(periods)) * (WIDTH - LEFT - RIGHT);

const renderTile = (/** @type {string} */ className) =>
  html`<rect class="${className}" x="${LEFT - 0.5}" y="0.5" width="${WIDTH - LEFT - RIGHT + 1}" height="${HEIGHT - 1}"></rect>`;

/**
 * The chart's shape while its scores load: the teams' names and a regulation game's periods
 * around a pulsing tile.
 * @param {{ away: string, home: string }} teams
 */
export const renderPendingLeadChart = (teams) =>
  renderChartFrame(
    teams,
    html`<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true">${renderTile("lead-tile pending")}</svg>`,
    renderPeriodNames(REGULATION_PERIODS, placeAcross(REGULATION_PERIODS)),
  );

/**
 * @param {Lead} lead
 * @param {{ away: string, home: string }} teams
 */
export function renderLeadChart(lead, teams) {
  const length = measureGame(lead.periods);
  const margins = listMargins(lead);
  const awayBest = findBiggestLead(margins, 1);
  const homeBest = findBiggestLead(margins, -1);
  const reach = chooseReach(Math.max(awayBest.margin, -homeBest.margin));
  const x = placeAcross(lead.periods);
  const y = (/** @type {number} */ margin) => MIDDLE - (margin / reach) * (PLOT_HEIGHT / 2);
  const end = lead.isOver ? length : margins[margins.length - 1].at;

  const steps = traceSteps(margins, end);
  const trace = (/** @type {number[][]} */ points) =>
    `M${points.map(([at, margin]) => `${formatCoordinate(x(at))},${formatCoordinate(y(margin))}`).join("L")}`;
  const closeToMiddle = (/** @type {(margin: number) => number} */ clamp) =>
    `${trace(steps.map(([at, margin]) => [at, clamp(margin)]))}L${formatCoordinate(x(end))},${MIDDLE}L${formatCoordinate(x(0))},${MIDDLE}Z`;
  const awayArea = closeToMiddle((margin) => Math.max(margin, 0));
  const homeArea = closeToMiddle((margin) => Math.min(margin, 0));

  const periodTicks = [...Array(lead.periods).keys()]
    .slice(1)
    .map(
      (index) =>
        html`<line class="lead-tick" x1="${x(measurePeriodStart(index))}" x2="${x(measurePeriodStart(index))}" y1="${MIDDLE - TICK_HALF}" y2="${MIDDLE + TICK_HALF}"></line>`,
    );
  const reachLines = [reach, -reach].map(
    (margin) =>
      html`<line class="lead-grid" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${y(margin)}" y2="${y(margin)}"></line>`,
  );
  const reachLabels = [reach, -reach].map(
    (margin) =>
      html`<span class="lead-reach" style="--y: ${formatDown(y(margin))}" aria-hidden="true">+${reach}</span>`,
  );
  const awayName = nameTeam(teams.away);
  const homeName = nameTeam(teams.home);
  const renderPeakDot = (
    /** @type {{ at: number, margin: number }} */ peak,
    /** @type {"away" | "home"} */ place,
  ) =>
    peak.margin
      ? html`<circle class="lead-peak ${place}" cx="${formatCoordinate(x(peak.at))}" cy="${formatCoordinate(y(peak.margin))}" r="3.5"></circle>`
      : "";
  const renderPeakLabel = (
    /** @type {{ at: number, margin: number }} */ peak,
    /** @type {string} */ name,
    /** @type {"away" | "home"} */ place,
  ) => {
    if (!peak.margin) return "";
    const label = `${name} +${Math.abs(peak.margin)}`;
    const where = `--x: ${formatAcross(x(peak.at))}; --y: ${formatDown(y(peak.margin))}; --length: ${label.length}`;
    return html`<span class="lead-peak-label ${place}" style="${where}" aria-hidden="true">${label}</span>`;
  };
  const label = [
    describeBiggestLead(awayName, awayBest.margin),
    describeBiggestLead(homeName, -homeBest.margin),
  ].join(", ");

  const plot = html`<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${capitalize(label)}">
      ${renderTile("lead-tile")}
      ${reachLines}
      <path class="lead-area away" d="${awayArea}"></path>
      <path class="lead-area home" d="${homeArea}"></path>
      <line class="lead-middle" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${MIDDLE}" y2="${MIDDLE}"></line>
      ${periodTicks}
      <path class="lead-line" d="${trace(steps)}"></path>
      ${renderPeakDot(awayBest, "away")}${renderPeakDot(homeBest, "home")}
    </svg>
    ${reachLabels}${renderPeakLabel(awayBest, awayName, "away")}${renderPeakLabel(homeBest, homeName, "home")}`;
  return renderChartFrame(teams, plot, renderPeriodNames(lead.periods, x));
}
