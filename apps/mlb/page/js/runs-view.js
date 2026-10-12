// The Game section's Runs so far, above its innings: a sentence for each club on how it scored,
// inning by inning, then, while a half inning is under way, the field with each runner by his
// base and how he got on, and who's up against whom. Once the game is final, it's the game's Runs.

import { html } from "#shared/html.js";
import { formatOrdinal } from "#shared/ordinal.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { nameTeam, renderTeamDot } from "./clubs.js";
import { describeInning, renderOutLights } from "./games-view.js";

const SIDES = /** @type {const} */ (["away", "home"]);
const HOME_RUNS = { 1: "solo homer", 2: "2-run homer", 3: "3-run homer", 4: "grand slam" };
const HITS = { Single: "single", Double: "double", Triple: "triple" };
// A walk or a hit batter scores a run only with the bases loaded.
const FORCED_IN = {
  Walk: "walk",
  "Intent Walk": "intentional walk",
  "Hit By Pitch": "hit by pitch",
};
const CREDITED = {
  "Sac Fly": "sac fly",
  "Sac Fly Double Play": "sac fly",
  "Sac Bunt": "sac bunt",
  "Fielders Choice": "fielder's choice",
  "Fielders Choice Out": "fielder's choice",
  Forceout: "forceout",
  "Grounded Into DP": "double play",
  "Double Play": "double play",
  "Stolen Base Home": "steal of home",
};
// What scores a run without anyone to credit it to.
const UNCREDITED = {
  "Field Error": "an error",
  Error: "an error",
  "Wild Pitch": "a wild pitch",
  "Passed Ball": "a passed ball",
  Balk: "a balk",
  "Catcher Interference": "catcher's interference",
};
const WAYS_ON = {
  Single: "singled",
  Double: "doubled",
  Triple: "tripled",
  Walk: "walked",
  "Intent Walk": "walked",
  "Hit By Pitch": "hit by pitch",
  "Field Error": "on an error",
  "Fielders Choice": "on a fielder's choice",
  "Fielders Choice Out": "on a fielder's choice",
  Forceout: "on a forceout",
  "Catcher Interference": "on interference",
  Strikeout: "on a dropped third strike",
};

// The field, drawn to scale in units from home plate up, 240 across, set 268px wide.
const FIELD_UNITS_WIDE = 240;
const FIELD_TOP = -12;
const FIELD_BOTTOM = 166;
const FIELD_WIDTH_PX = 268;
const PX_PER_UNIT = FIELD_WIDTH_PX / FIELD_UNITS_WIDE;
const BASES = { "1B": [172, 90], "2B": [120, 38], "3B": [68, 90] };
const FENCE = "M120 152L25 57A101.6 101.6 0 0 1 215 57Z";
// The infield grass, with a bite out of it around each base; its corner at home hides under the
// dirt there.
const GRASS =
  "M120 142L165.6 96.4A9 9 0 0 1 165.6 83.6L126.4 44.4A9 9 0 0 1 113.6 44.4L74.4 83.6A9 9 0 0 1 74.4 96.4Z";
// The dirt around home plate, its edge open where the base paths run in.
const HOME_DIRT_EDGE =
  "M129.9 142.1A14 14 0 1 1 110.1 142.1M116.46 138.46A14 14 0 0 1 123.54 138.46";
const HOME_PLATE = "M115.5 149h9v4l-4.5 4-4.5-4z";
const BASE_SIDE_PX = 9.2;
const BASE_HALF_DIAGONAL_PX = (BASE_SIDE_PX * Math.SQRT2) / 2;
// From a base's tip to the name beside it, and, at 2nd, from the base's middle to the name over it.
const NAME_GAP_PX = 6;
const NAME_OVER_SECOND_PX = 9;
// The sheet's color behind a name, where it crosses a line, reaches this far past its letters.
const NAME_PADDING_PX = 3;

/** @typedef {{ away: string, home: string }} RunsGame */
/** @typedef {{ side: "away" | "home", inning: number, event: string, player: string, rbi: number, runs: number }} RunPlay */

/** @param {string} name */
const makePossessive = (name) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/**
 * How a play scored its runs, in a fan's words, like "Ramirez's 2-run homer" or "a wild pitch".
 * @param {RunPlay} play
 */
export function describeRunPlay({ event, player, rbi }) {
  if (event in UNCREDITED) return UNCREDITED[event];
  return `${makePossessive(player)} ${describeCredit(event, rbi)}`;
}

/**
 * @param {string} event
 * @param {number} rbi
 */
function describeCredit(event, rbi) {
  if (event === "Home Run") return HOME_RUNS[rbi] ?? "homer";
  if (event in HITS) return [describeRunsBattedIn(rbi), HITS[event]].filter(Boolean).join(" ");
  if (event in FORCED_IN) return `bases-loaded ${FORCED_IN[event]}`;
  if (event in CREDITED) return CREDITED[event];
  return [describeRunsBattedIn(rbi), event.toLowerCase()].filter(Boolean).join(" ");
}

/** @param {number} rbi */
const describeRunsBattedIn = (rbi) => (rbi > 1 ? `${rbi}-run` : rbi === 1 ? "RBI" : "");

/** @param {string[]} items */
function joinWithAnd(items) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * A club's runs, each inning's plays in a phrase, like "Bailey's solo homer in the 5th".
 * @param {RunPlay[]} plays
 */
function describeInnings(plays) {
  /** @type {RunPlay[][]} */
  const innings = [];
  for (const play of plays) {
    if (innings.at(-1)?.[0].inning === play.inning) innings.at(-1)?.push(play);
    else innings.push([play]);
  }
  return innings
    .map(
      (inning) =>
        `${joinWithAnd(inning.map(describeRunPlay))} in the ${formatOrdinal(inning[0].inning)}`,
    )
    .join(", then ");
}

/**
 * @param {RunsGame} game
 * @param {any} boxScore
 * @param {"away" | "home"} side
 */
function renderClubRuns(game, boxScore, side) {
  const plays = boxScore.scoring.filter((/** @type {RunPlay} */ play) => play.side === side);
  const total = html`<b>${nameTeam(game[side])} ${boxScore.totals[side].runs}</b>`;
  return html`<p class="runs-club">
    ${renderTeamDot(game[side])}<span>${total}${plays.length > 0 && ` on ${describeInnings(plays)}`}</span>
  </p>`;
}

/**
 * A point on the field, in pixels from its drawing's top left.
 * @param {number[]} point
 */
const placeOnField = ([x, y]) => [x * PX_PER_UNIT, (y - FIELD_TOP) * PX_PER_UNIT];

/**
 * Where a runner's name goes: over 2nd, centered on it, or beside 1st or 3rd, level with it, each
 * as a point the name's box sits against.
 * @param {string} base
 */
function placeRunnerName(base) {
  const [x, y] = placeOnField(BASES[base]);
  const besideBase = BASE_HALF_DIAGONAL_PX + NAME_GAP_PX - NAME_PADDING_PX;
  if (base === "2B") return { left: x, top: y - NAME_OVER_SECOND_PX };
  return { left: base === "1B" ? x + besideBase : x - besideBase, top: y };
}

/** @param {{ base: string, name: string, reached: string | null }} runner */
function renderRunner({ base, name, reached }) {
  const { left, top } = placeRunnerName(base);
  const wayOn = reached && (WAYS_ON[reached] ?? reached.toLowerCase());
  return html`<div class="runs-runner on-${base}" style="left:${left.toFixed(2)}px;top:${top.toFixed(2)}px">
    <span class="runs-runner-name"><b>${name}</b>${wayOn && html`<span>${wayOn}</span>`}</span>
  </div>`;
}

/**
 * A base, a square turned on its point, filled when a runner is on it.
 * @param {string} base
 * @param {boolean} isTaken
 */
function renderBase(base, isTaken) {
  const [x, y] = BASES[base];
  const reach = BASE_HALF_DIAGONAL_PX / PX_PER_UNIT;
  const corners = [
    [x, y - reach],
    [x + reach, y],
    [x, y + reach],
    [x - reach, y],
  ].map((corner) => corner.map((value) => value.toFixed(2)).join(" "));
  return html`<path d="M${corners.join("L")}Z" class="runs-base ${isTaken ? "taken" : ""}" />`;
}

/** @param {any[]} runners */
function renderField(runners) {
  const taken = new Set(runners.map((runner) => runner.base));
  const height = FIELD_BOTTOM - FIELD_TOP;
  return html`<div class="runs-field">
    <svg viewBox="0 ${FIELD_TOP} ${FIELD_UNITS_WIDE} ${height}" aria-hidden="true">
      <path d="${FENCE}" class="runs-line" />
      <path d="${GRASS}" class="runs-line" />
      <circle cx="120" cy="152" r="14" class="runs-home-dirt" />
      <path d="${HOME_DIRT_EDGE}" class="runs-line" />
      ${Object.keys(BASES).map((base) => renderBase(base, taken.has(base)))}
      <path d="${HOME_PLATE}" class="runs-base" />
    </svg>
    ${runners.map(renderRunner)}
  </div>`;
}

/** @param {any} bases */
function renderUp({ batter, pitcher }) {
  if (!batter || !pitcher) return html``;
  return html`<p class="runs-up"><b>${batter}</b> is up against <b>${pitcher}</b></p>`;
}

/** @param {any} bases the half inning under way, from the box score */
function renderNow(bases) {
  const inning = describeInning(bases);
  const outs = renderOutLights({ state: "live", outs: bases.outs });
  return html`<div class="runs-now">
    <p class="runs-now-head"><span class="runs-now-label">Now</span><span class="runs-now-inning">${inning}${outs}</span></p>
    ${renderField(bases.runners)}${renderUp(bases)}
  </div>`;
}

/**
 * @param {RunsGame} game
 * @param {any} boxScore a game's box score once it has started
 */
export function renderRuns(game, boxScore) {
  if (!Array.isArray(boxScore.scoring)) return html``;
  const isLive = boxScore.state === "live";
  return renderSheetPart(
    isLive ? "Runs so far" : "Runs",
    html`${SIDES.map((side) => renderClubRuns(game, boxScore, side))}${isLive && boxScore.bases && renderNow(boxScore.bases)}`,
  );
}
