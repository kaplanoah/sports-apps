// A player's number in a stat beside where it ranks, on a curve of every ranked player's number in
// it, smoothed, with the player's mark on it, as a player's sheet shows each ranked stat, or with
// several players' marks on one curve, as MLB's pitching matchup shows its two starters, or a number
// beside another to measure it against, each a dot on a line solid across a range and dashed past
// it as far as a number reaches, as a team's sheet shows its playoffs against the playoff field's,
// on the regular season's range. A stat where fewer is better runs from the most to the fewest, so
// a better rank always sits further right. A player not yet ranked, but a quarter of the way to
// what qualifying takes, shows where he would rank, marked with a line and no dot, which stops at
// the curve's end when his number is past it. The marks sit in a box over the curve, so an app can
// draw them a little inside its ends. rank-curve.css draws the curve and its marks, in the mark
// color each app sets, and a line's solid and dashed stretches, and each app colors a line's dots
// from its own stylesheet.

import { html, joinNames } from "./html.js";
import { formatOrdinal } from "./ordinal.js";

// The curve's drawing is 100 wide and 20 tall, its peak kept CURVE_HEADROOM below the top.
const CURVE_WIDTH = 100;
const CURVE_HEIGHT = 20;
const CURVE_HEADROOM = 2;
const CURVE_POINTS = 48;
const NEARLY_RANKED_SHARE = 0.25;

/**
 * A player's rank in a stat, among every ranked player's number in it. A player without a rank
 * has `rank` null, and `wouldRank` where he would rank once he's nearly qualified.
 * @typedef {{ value: number | null, rank: number | null, wouldRank?: number | null, count: number, values: number[] }} RankedStat
 */

/**
 * Whether a player is far enough toward qualifying to show where he would rank.
 * @param {number | null | undefined} progress his share of what qualifying takes
 */
export const isNearlyRanked = (progress) => progress != null && progress >= NEARLY_RANKED_SHARE;

/** @param {string} players who the player would be compared with */
export const describeSmallSample = (players) =>
  `too small a sample to fairly compare with ${players}`;

/**
 * How wide each player's number spreads on the curve, by Silverman's rule of thumb.
 * @param {number[]} values
 */
function measureBandwidth(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return 1.06 * (Math.sqrt(variance) || 1) * values.length ** -0.2;
}

/**
 * The shape of every ranked player's numbers in a stat, smoothed, across the drawing from the
 * lowest to the highest, or the other way round when the fewest ranks first, and where a number
 * sits on it, as a share of the drawing from 0 to 100, a number past either end sitting at that
 * end.
 * @param {number[]} values from the lowest
 * @param {boolean} isFewestFirst
 */
function drawCurve(values, isFewestFirst) {
  const low = values[0];
  const high = values.at(-1) ?? low;
  const width = measureBandwidth(values);
  /** @param {number} at */
  const measureDensity = (at) =>
    values.reduce((sum, each) => sum + Math.exp(-0.5 * ((at - each) / width) ** 2), 0);
  /** @param {number} share of the drawing's width, from 0 to 1 */
  const placeShare = (share) => (isFewestFirst ? 1 - share : share);
  const steps = Array.from({ length: CURVE_POINTS }, (_, index) => {
    const share = placeShare(index / (CURVE_POINTS - 1));
    return low + (high - low) * share;
  });
  const densities = steps.map(measureDensity);
  const tallest = Math.max(...densities);
  /** @param {number} density */
  const placeHeight = (density) =>
    CURVE_HEIGHT - (density / tallest) * (CURVE_HEIGHT - CURVE_HEADROOM);
  const line = densities
    .map(
      (density, index) =>
        `${((index / (CURVE_POINTS - 1)) * CURVE_WIDTH).toFixed(1)},${placeHeight(density).toFixed(1)}`,
    )
    .join(" L");
  return {
    area: `M0,${CURVE_HEIGHT} L${line} L${CURVE_WIDTH},${CURVE_HEIGHT} Z`,
    edge: `M${line}`,
    /** @param {number} value */
    place: (value) => {
      const onCurve = Math.min(high, Math.max(low, value));
      return {
        left: high > low ? placeShare((onCurve - low) / (high - low)) * 100 : 50,
        top: (placeHeight(measureDensity(onCurve)) / CURVE_HEIGHT) * 100,
      };
    },
  };
}

/**
 * The shape of every ranked player's numbers in a stat, and where the player's sits on it.
 * @param {number[]} values from the lowest
 * @param {number} value the player's
 * @param {boolean} [isFewestFirst]
 */
export function drawSpread(values, value, isFewestFirst = false) {
  const { area, edge, place } = drawCurve(values, isFewestFirst);
  return { area, edge, ...place(value) };
}

/**
 * A number marked on a curve: whose it is, if a class names it, and whether it's where a player
 * not yet ranked would rank, a line with no dot.
 * @typedef {{ value: number, className?: string, isProvisional?: boolean }} CurveMark
 */

/**
 * A curve of every ranked player's numbers in a stat, with a mark for each number given.
 * @param {number[]} values from the lowest
 * @param {CurveMark[]} marks
 * @param {boolean} [isFewestFirst]
 */
export function renderSpreadCurve(values, marks, isFewestFirst = false) {
  const { area, edge, place } = drawCurve(values, isFewestFirst);
  const renderMark = (/** @type {CurveMark} */ mark) => {
    const { left, top } = place(mark.value);
    const style = `left: ${left.toFixed(1)}%; top: ${top.toFixed(1)}%`;
    const classes = [mark.className, mark.isProvisional && "provisional"].filter(Boolean).join(" ");
    const owner = classes ? html` class="${classes}"` : "";
    if (mark.isProvisional) return html`<i${owner} style="${style}"></i>`;
    return html`<i${owner} style="${style}"></i><b${owner} style="${style}"></b>`;
  };
  return html`<span class="player-curve" aria-hidden="true">
    <svg viewBox="0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}" preserveAspectRatio="none">
      <path class="player-curve-area" d="${area}"></path>
      <path class="player-curve-edge" d="${edge}"></path>
    </svg>
    <span>${marks.map(renderMark)}</span>
  </span>`;
}

/**
 * @param {RankedStat} stat
 * @param {boolean} [isFewestFirst]
 */
function renderCurve(stat, isFewestFirst) {
  const isMarked = stat.rank != null || stat.wouldRank != null;
  if (!isMarked || stat.value == null || !stat.values.length)
    return html`<span class="player-curve"></span>`;
  const mark = { value: stat.value, isProvisional: stat.rank == null };
  return renderSpreadCurve(stat.values, [mark], isFewestFirst);
}

/**
 * Where a player not yet ranked would rank, as his rank's place is written.
 * @param {number} rank
 */
export const describeWouldRank = (rank) => `would be ${formatOrdinal(rank)}`;

/**
 * The note under ranks that says which stats rank from the fewest, like ERA or turnovers.
 * @param {string[]} labels
 */
export const describeFewestFirst = (labels) => `${joinNames(labels, "and")} ranked by fewest`;

/** @param {RankedStat} stat */
function describeRank(stat) {
  if (stat.rank != null) return `${formatOrdinal(stat.rank)} of ${stat.count}`;
  return stat.wouldRank != null && describeWouldRank(stat.wouldRank);
}

/** @param {RankedStat} stat */
const renderRank = (stat) => html`<span class="player-rank">${describeRank(stat)}</span>`;

/**
 * One ranked stat's row: its label, the player's number as the sheet writes it, the curve, and
 * the rank.
 * @param {{ label: string, shown: string | number, stat: RankedStat, isFewestFirst?: boolean }} row
 */
export const renderRankRow = ({ label, shown, stat, isFewestFirst = false }) =>
  html`<div class="player-rank-row">
    <span class="player-rank-label">${label}</span>
    <span class="player-rank-value tabular">${shown}</span>
    ${renderCurve(stat, isFewestFirst)}${renderRank(stat)}
  </div>`;

/**
 * A player's rank in a stat among every ranked player's number in it, counting only those strictly
 * better, so tied players share one, or none when the player isn't ranked, with where he would
 * rank once he's nearly qualified.
 * @param {number[]} values every ranked player's
 * @param {number | null} value the player's
 * @param {{ isRanked: boolean, isFewestFirst?: boolean, progress?: number | null }} options his
 *   progress is his share of what qualifying takes
 * @returns {RankedStat}
 */
export function rankAmong(values, value, { isRanked, isFewestFirst = false, progress = null }) {
  const sorted = [...values].sort((first, second) => first - second);
  const unranked = { value, rank: null, count: sorted.length, values: sorted };
  if (value == null) return unranked;
  const place = 1 + sorted.filter((each) => (isFewestFirst ? each < value : each > value)).length;
  if (isRanked) return { ...unranked, rank: place };
  return isNearlyRanked(progress) ? { ...unranked, wouldRank: place } : unranked;
}

/**
 * Where a number sits on a range, as a share of it from 0 to 100, its better end on the right: the
 * highest, or the lowest when the fewest ranks first. A number past either end sits at that end,
 * and one without a range to sit on has no place.
 * @param {number | null} value
 * @param {[number, number] | null} range its lowest and highest
 * @param {boolean} [isFewestFirst]
 * @returns {number | null}
 */
export function placeOnRange(value, range, isFewestFirst = false) {
  if (value == null || !range || !(range[1] > range[0])) return null;
  const share = Math.min(1, Math.max(0, (value - range[0]) / (range[1] - range[0])));
  return Math.round((isFewestFirst ? 1 - share : share) * 1000) / 10;
}

/**
 * A number as written and where it sits on a range, or null where it has no place.
 * @typedef {{ shown: string, at: number | null }} PlacedNumber
 */

/**
 * @param {number | null} at
 * @param {"own" | "other"} whose
 */
const renderPlace = (at, whose) =>
  at != null && html`<i class="${whose}" style="left: ${at}%"></i>`;

// A stretch of the line that ends where the line does reaches past the dots' box to its end.
const LINE_END = "calc(-1 * var(--placed-inset))";

/** @param {number} at from 0 to 100 */
const roundPlace = (at) => Math.round(at * 10) / 10;

/**
 * A stretch of a line, from one place on it to another, each from 0 to 100.
 * @param {string} className
 * @param {number} from
 * @param {number} to
 */
function renderStretch(className, from, to) {
  const left = from > 0 ? `${roundPlace(from)}%` : LINE_END;
  const right = to < 100 ? `${roundPlace(100 - to)}%` : LINE_END;
  return html`<b class="${className}" style="left: ${left}; right: ${right}"></b>`;
}

/**
 * A line solid over the range it measures against, and dashed past either end of it.
 * @param {[number, number]} range where the range starts and ends on the line, from 0 to 100
 */
const renderLine = ([from, to]) =>
  html`${from > 0 && renderStretch("placed-past toward-start", 0, from)}${renderStretch("placed-range", from, to)}${to < 100 && renderStretch("placed-past toward-end", to, 100)}`;

/**
 * One stat's row of a number measured against another: its label, the number, a line with a dot
 * where each sits, the number's own drawn over the other's, and the other number. The line is
 * solid over the range it measures against and dashed past it, as far as a number reaches. The
 * dots sit in a box inside the line, so each app sets how far a dot at either end reaches past it.
 * @param {{ label: string, own: PlacedNumber, other: PlacedNumber, range?: [number, number] }} row
 *   the range's place on the line, the whole line unless a number reaches past it
 */
export const renderPlacedRow = ({ label, own, other, range = [0, 100] }) =>
  html`<div class="player-rank-row">
    <span class="player-rank-label">${label}</span>
    <span class="player-rank-value tabular">${own.shown}</span>
    <span class="placed-line" aria-hidden="true"><span>${renderLine(range)}${renderPlace(other.at, "other")}${renderPlace(own.at, "own")}</span></span>
    <span class="placed-other tabular">${other.shown}</span>
  </div>`;
