// The Game section's Runs so far, above its innings: each half inning that scored, under its
// heading, and a line for each change of the score with the score after it, the runners who got on
// since the last one on a lighter row over the play that scored, a pinch runner who scored named
// with whom he ran for. Then, while the game is being played, who's pinch running for whom, the
// field with each runner by his base and how he got on, and who's up against whom, or, between
// halves, the empty field and who's due up. Once the game is final, it's the game's Runs.

import { html } from "#shared/html.js";
import { formatOrdinal } from "#shared/ordinal.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderTeamDot } from "./clubs.js";
import { describeInning, renderOutLights } from "./games-view.js";

const HALF_NAMES = { away: "Top", home: "Bottom" };
const REACHED = {
  Single: "singled",
  Double: "doubled",
  Triple: "tripled",
  Walk: "walked",
  "Intent Walk": "walked",
  "Hit By Pitch": "was hit by a pitch",
  "Field Error": "reached on an error",
  "Fielders Choice": "reached on a fielder's choice",
  "Fielders Choice Out": "reached on a fielder's choice",
  Forceout: "reached on a forceout",
  "Catcher Interference": "reached on interference",
  Strikeout: "reached on a dropped third strike",
};
const DROVE_HOME = { Single: "singled home", Double: "doubled home", Triple: "tripled home" };
// A walk, a hit batter, or interference scores a run only by forcing it in from loaded bases.
const FORCES = new Set(["Walk", "Intent Walk", "Hit By Pitch", "Catcher Interference"]);
const MADE_OUT = {
  Groundout: "grounded out",
  "Bunt Groundout": "grounded out",
  Flyout: "flied out",
  Lineout: "lined out",
  "Pop Out": "popped out",
  "Grounded Into DP": "grounded into a double play",
  "Double Play": "hit into a double play",
  Strikeout: "struck out",
  "Sac Bunt": "sacrificed",
};
// What scores a runner during a play without the batter driving him in.
const SCORED_ON = {
  "Wild Pitch": "a wild pitch",
  "Passed Ball": "a passed ball",
  Balk: "a balk",
  "Field Error": "an error",
  Error: "an error",
  "Stolen Base Home": "a steal of home",
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
/** @typedef {{ away: number, home: number }} Score */
/** @typedef {{ name: string, event: string, pinchRunnerFor?: string | null }} Scorer */
/** @typedef {{ base: string, name: string, reached: string | null, pinchRunnerFor?: string | null }} Runner */
/** @typedef {{ batter: string, event: string, reached: boolean, filledBases: boolean, scorers: Scorer[], score: Score | null }} HalfPlay */
/** @typedef {{ side: "away" | "home", inning: number, plays: HalfPlay[] }} ScoringHalf */
/** @typedef {{ setup: HalfPlay[], play: HalfPlay }} ScoreChange */

/** @param {string} name */
const makePossessive = (name) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** @param {string[]} items */
function joinWithAnd(items) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * A runner who scored, and whom he ran for if he came in to pinch run.
 * @param {Scorer} scorer
 */
const nameScorer = ({ name, pinchRunnerFor }) =>
  pinchRunnerFor ? `${name} (pinch runner for ${pinchRunnerFor})` : name;

/** @param {HalfPlay} play */
const describeWhatBatterDid = (play) =>
  REACHED[play.event] ?? MADE_OUT[play.event] ?? play.event.toLowerCase();

/**
 * How a batter's own play scored the runners it did, like "Bazzana doubled home Martinez".
 * @param {HalfPlay} play
 * @param {string[]} names the runners it drove in
 * @param {boolean} isLoadedSaid whether the line already says the bases got loaded
 */
function describeDrivenIn(play, names, isLoadedSaid) {
  const runners = joinWithAnd(names);
  if (play.event === "Home Run") return [`${play.batter} homered`, runners && `scoring ${runners}`];
  if (play.event in DROVE_HOME) return [`${play.batter} ${DROVE_HOME[play.event]} ${runners}`];
  if (FORCES.has(play.event)) {
    const loaded = isLoadedSaid ? "" : " with the bases loaded";
    return [`${play.batter} ${REACHED[play.event]}${loaded}`, `forcing in ${runners}`];
  }
  if (play.event.startsWith("Sac Fly"))
    return [`${makePossessive(play.batter)} sac fly scored ${runners}`];
  return [`${play.batter} ${describeWhatBatterDid(play)}`, `scoring ${runners}`];
}

/**
 * The play that changed the score, in a fan's words: what the batter did and who it drove in, and
 * anyone who scored on something else during it, like "Bailey scored on a wild pitch".
 * @param {HalfPlay} play
 * @param {boolean} isLoadedSaid
 */
export function describeScoringPlay(play, isLoadedSaid = false) {
  const drivenIn = play.scorers.filter((scorer) => scorer.event === play.event);
  /** @type {Map<string, Scorer[]>} */
  const scoredOn = new Map();
  for (const scorer of play.scorers.filter((each) => each.event !== play.event))
    scoredOn.set(scorer.event, [...(scoredOn.get(scorer.event) ?? []), scorer]);
  const batter =
    drivenIn.length > 0 || play.event === "Home Run"
      ? describeDrivenIn(play, drivenIn.map(nameScorer), isLoadedSaid).filter(Boolean).join(", ")
      : play.reached && `${play.batter} ${describeWhatBatterDid(play)}`;
  const others = [...scoredOn].map(
    ([event, scorers]) =>
      `${joinWithAnd(scorers.map(nameScorer))} scored on ${SCORED_ON[event] ?? event.toLowerCase()}`,
  );
  return joinWithAnd([batter, ...others].filter(Boolean));
}

/**
 * The runners who got on since the last change of the score, those who got on the same way in a
 * row together, like "Rocchio and Kwan walked, loading the bases".
 * @param {HalfPlay[]} plays
 */
export function describeSetup(plays) {
  /** @type {{ way: string, names: string[], filledBases: boolean }[]} */
  const groups = [];
  for (const play of plays) {
    const way = describeWhatBatterDid(play);
    const last = groups.at(-1);
    if (last?.way === way && !last.filledBases) {
      last.names.push(play.batter);
      last.filledBases = play.filledBases;
    } else groups.push({ way, names: [play.batter], filledBases: play.filledBases });
  }
  return joinWithAnd(
    groups.map(
      ({ way, names, filledBases }) =>
        `${joinWithAnd(names)} ${way}${filledBases ? ", loading the bases" : ""}`,
    ),
  );
}

/**
 * Each change of the score in a half inning, with the runners who got on since the last one.
 * Runners who got on after its last change aren't in any.
 * @param {ScoringHalf} half
 * @returns {ScoreChange[]}
 */
function listScoreChanges(half) {
  const changes = [];
  /** @type {HalfPlay[]} */
  let setup = [];
  for (const play of half.plays) {
    if (play.score) {
      changes.push({ setup, play });
      setup = [];
    } else setup.push(play);
  }
  return changes;
}

/**
 * The score after a change, the club that changed it in bold.
 * @param {"away" | "home"} side
 * @param {Score} score
 */
function renderScore(side, score) {
  const renderSide = (/** @type {"away" | "home"} */ each) =>
    each === side ? html`<b>${score[each]}</b>` : String(score[each]);
  return html`<span class="runs-score">${renderSide("away")}-${renderSide("home")}</span>`;
}

/**
 * @param {"away" | "home"} side
 * @param {ScoreChange} change
 */
function renderScoreChange(side, { setup, play }) {
  const isLoadedSaid = setup.some((each) => each.filledBases);
  return html`<li class="runs-change">
    <span class="runs-change-text"
      >${setup.length > 0 && html`<span class="runs-setup">${describeSetup(setup)}</span>`}<span
        class="runs-play"
        >${describeScoringPlay(play, isLoadedSaid)}</span
      ></span
    >${renderScore(side, /** @type {Score} */ (play.score))}
  </li>`;
}

/**
 * @param {RunsGame} game
 * @param {ScoringHalf} half
 */
function renderHalf(game, half) {
  return html`<div class="runs-half">
    <p class="runs-half-head">
      ${renderTeamDot(game[half.side])}<span>${HALF_NAMES[half.side]} ${formatOrdinal(half.inning)}</span>
    </p>
    <ul class="runs-changes">
      ${listScoreChanges(half).map((change) => renderScoreChange(half.side, change))}
    </ul>
  </div>`;
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

/** @param {Runner} runner */
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

/** @param {Runner[]} runners */
function renderPinchRunners(runners) {
  const pinchRunners = runners.filter((runner) => runner.pinchRunnerFor);
  if (pinchRunners.length === 0) return html``;
  return html`<p class="runs-pinch-runners">
    ${pinchRunners.map(
      (runner) =>
        html`<span><b>${runner.name}</b> pinch running for <b>${runner.pinchRunnerFor}</b></span>`,
    )}
  </p>`;
}

/** @param {Runner[]} runners */
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

const isBetweenHalves = (bases) => bases.half === "middle" || bases.half === "end";

/** @param {any} bases */
function renderUp(bases) {
  const { batter, pitcher } = bases;
  if (!batter || !pitcher) return html``;
  const up = isBetweenHalves(bases) ? "due up against" : "up against";
  return html`<p class="runs-up"><b>${batter}</b> ${up} <b>${pitcher}</b></p>`;
}

/** @param {any} bases where the game stands, from the box score */
function renderNow(bases) {
  const inning = describeInning(bases);
  const outs = isBetweenHalves(bases)
    ? html``
    : renderOutLights({ state: "live", outs: bases.outs });
  return html`<div class="runs-now">
    <p class="runs-now-head"><span class="runs-now-label">Now</span><span class="runs-now-inning">${inning}${outs}</span></p>
    ${renderPinchRunners(bases.runners)}${renderField(bases.runners)}${renderUp(bases)}
  </div>`;
}

/**
 * @param {RunsGame} game
 * @param {any} boxScore a game's box score once it has started
 */
export function renderRuns(game, boxScore) {
  const halves = boxScore.scoringHalves;
  if (!Array.isArray(halves)) return html``;
  const isLive = boxScore.state === "live";
  const runs =
    halves.length > 0
      ? html`<div class="runs-halves">${halves.map((half) => renderHalf(game, half))}</div>`
      : html`<p class="runs-none">No runs yet</p>`;
  return renderSheetPart(
    isLive ? "Runs so far" : "Runs",
    html`${runs}${isLive && boxScore.bases && renderNow(boxScore.bases)}`,
  );
}
