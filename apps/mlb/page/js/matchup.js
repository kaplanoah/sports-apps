// The Matchup section of a game's sheet: the two starters face to face, where each ranks among the
// season's qualified starters, both marked in their clubs' colors on a curve of every qualified
// starter's number in each measure, what each throws, and their last starts. A club yet to name
// today's starter shows who started its last games instead, and how rested each would be, and any
// other starter still to be named is one to check back for. Until each side loads, placeholders
// hold its shape. A side that didn't load says so with a Try again button: under the starter's club
// when the other side did load, or once for the whole section when nothing did.

import { nameTeam, renderClub, renderClubName } from "./clubs.js";
import { renderArm } from "./games-view.js";
import { formatShortDate, readCalendarDate, readEasternDay } from "#shared/days.js";
import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import {
  classifyReadFailure,
  renderRetryBlock,
  renderRetryButton,
  renderRetryMessage,
  renderRetryNote,
} from "#shared/retry.js";
import { measureSpeedRange, renderPendingPitchMix, renderPitchMix } from "./pitch-mix.js";
import { fetchPitcher, fetchRotation } from "./pitcher-fetch.js";
import { renderPlayerButton } from "./player-button.js";
import { describeInningsToQualify, measureInningsProgress } from "./qualifying.js";
import { describeGamePitching, formatInnings } from "./stat-table.js";
import { TEAMS } from "./teams.js";
import { formatOrdinal } from "#shared/ordinal.js";
import {
  describeFewestFirst,
  describeWouldRank,
  rankAmong,
  renderSpreadCurve,
} from "#shared/rank-curve.js";
import { pickSideColors } from "#shared/team-colors.js";

const SIDES = ["away", "home"];
const USUAL_REST_DAYS = 4;
// The Worker sends a starter's last three starts, and a club's last five starters.
const PENDING_STARTS = 3;
const PENDING_ROTATION = 5;
// A lower ERA and fewer walks rank first.
const TAPE = [
  { key: "era", label: "ERA", format: (line) => line.era, isFewestFirst: true },
  { key: "k9", label: "K/9", format: (line) => line.k9.toFixed(1) },
  { key: "bb9", label: "BB/9", format: (line) => line.bb9.toFixed(1), isFewestFirst: true },
  { key: "speed", label: "Fastball mph", format: (line) => line.speed.toFixed(1) },
];

const isLoadingPitcher = (side) => Boolean(side.starter?.name) && !side.pitcher && !side.failure;

function renderBio(side) {
  const { pitcher } = side;
  if (isLoadingPitcher(side))
    return html`<span class="pitcher-bio">${renderPlaceholder("R Age 00")}</span>`;
  if (!pitcher) return html``;
  const age = pitcher.age && html`<span>Age ${pitcher.age}</span>`;
  return html`<span class="pitcher-bio">${renderArm(pitcher.hand)}${age}</span>`;
}

// The game keeps a starter's first name beside his last, so it shows even when his numbers don't.
const readFirstName = (side) => side.pitcher?.firstName || side.starter?.firstName || "";

const hasFirstName = (side) => isLoadingPitcher(side) || Boolean(readFirstName(side));

// A side without a first name keeps its line empty while the other shows one, so the two last
// names, and the clubs under them, line up.
function renderFirstName(side, isFirstLineShown) {
  if (isLoadingPitcher(side) && !side.starter?.firstName)
    return html`<span class="pitcher-first">${renderPlaceholder("Firstname")}</span>`;
  const first = readFirstName(side);
  if (first) return html`<span class="pitcher-first">${first}</span>`;
  return isFirstLineShown
    ? html`<span class="pitcher-first" aria-hidden="true">&nbsp;</span>`
    : html``;
}

// A named starter's name opens his sheet.
function renderName(side, isFirstLineShown) {
  const { starter, pitcher } = side;
  const last = pitcher?.lastName || starter?.name || (starter ? "Not named yet" : "TBD");
  const content = html`${renderFirstName(side, isFirstLineShown)}<span class="pitcher-last">${last}</span>`;
  if (!starter?.id || !side.club) return html`<span class="pitcher-name">${content}</span>`;
  const name = [readFirstName(side), last].filter(Boolean).join(" ");
  return renderPlayerButton({ id: starter.id, name }, side.club, {
    content,
    className: "pitcher-name",
  });
}

// Under the club of a starter whose numbers didn't load, where his hand and age would be.
const renderSideRetry = () =>
  html`<div class="retry-side">${renderRetryMessage("Couldn't load")}${renderRetryButton()}</div>`;

/**
 * @param {any} side
 * @param {boolean} isSectionFailed
 * @param {boolean} isFirstLineShown
 */
function renderPitcherId(side, isSectionFailed, isFirstLineShown) {
  const { club } = side;
  const isRetryShown = Boolean(side.failure) && Boolean(side.starter?.name) && !isSectionFailed;
  return html`<div class="pitcher-id ${side.key}">
    ${renderName(side, isFirstLineShown)}
    ${club ? renderClub(club) : html``}
    ${renderBio(side)}
    ${isRetryShown && renderSideRetry()}
  </div>`;
}

/**
 * How each starter's number in a measure stands against the other's: better or worse when both
 * are ranked and one ranks higher, unranked when his isn't ranked, and level otherwise. Two ranked
 * numbers that read the same stand level, since numbers are rounded to be shown and marking either
 * as ahead would look wrong.
 * @param {any[]} sides
 * @param {(typeof TAPE)[number]} measure
 * @returns {("better" | "worse" | "unranked" | null)[]}
 */
function findStandings(sides, measure) {
  const shown = sides.map((side) =>
    side.pitcher?.line?.[measure.key] == null ? null : measure.format(side.pitcher.line),
  );
  const ranks = sides.map((side) => side.pitcher?.ranks?.[measure.key]?.rank ?? null);
  const isCompared = ranks.every(Boolean) && shown[0] !== shown[1];
  return sides.map((_, index) => {
    if (shown[index] == null) return null;
    if (!ranks[index]) return "unranked";
    if (!isCompared) return null;
    return ranks[index] < ranks[1 - index] ? "better" : "worse";
  });
}

/**
 * Each starter's marks and dots take his club's color, the two picked to read apart, in each
 * theme's own colors.
 * @param {any[]} sides
 */
function formatSideColors(sides) {
  const [away, home] = sides.map((side) => TEAMS[side.club]);
  if (!away || !home) return "";
  const dark = pickSideColors(away.chartColors, home.chartColors);
  const light = pickSideColors(away.lightChartColors, home.lightChartColors);
  return `--away-dark: ${dark.away}; --home-dark: ${dark.home}; --away-light: ${light.away}; --home-light: ${light.home}`;
}

const renderPendingNumber = (side) =>
  html`<span class="tape-number ${side.key}">
    <span class="tape-number-line">${renderPlaceholder("0.00")}</span>
    <span class="tape-rank">${renderPlaceholder("00th")}</span>
  </span>`;

/**
 * A starter's rank in a measure, written under his number: his rank, or where he would rank once
 * he's nearly qualified, or nothing.
 * @param {any} side
 * @param {(typeof TAPE)[number]} measure
 * @param {number | null} wouldRank
 */
function renderRank(side, measure, wouldRank) {
  const rank = side.pitcher.ranks?.[measure.key];
  if (rank) return html`<span class="tape-rank">${formatOrdinal(rank.rank)}</span>`;
  return wouldRank != null && html`<span class="tape-rank">${describeWouldRank(wouldRank)}</span>`;
}

/**
 * A starter's number in a measure under his side of the face-off, over his rank, bolder when it
 * ranks higher than the other starter's and dimmed when it ranks lower.
 * @param {any} side
 * @param {(typeof TAPE)[number]} measure
 * @param {"better" | "worse" | "unranked" | null} standing
 * @param {number | null} wouldRank
 */
function renderNumber(side, measure, standing, wouldRank) {
  if (isLoadingPitcher(side)) return renderPendingNumber(side);
  const line = side.pitcher?.line;
  if (line?.[measure.key] == null) return html`<span class="tape-number ${side.key}"></span>`;
  const classes = ["tape-number", side.key, standing].filter(Boolean).join(" ");
  return html`<span class="${classes}">
    <span class="tape-number-line"><span class="tape-dot"></span><span class="tabular">${measure.format(line)}</span></span>
    ${renderRank(side, measure, wouldRank)}
  </span>`;
}

/**
 * Every qualified starter's number in a measure, from the lowest, or null before either side's
 * numbers load.
 * @param {any[]} sides
 * @param {(typeof TAPE)[number]} measure
 * @returns {number[] | null}
 */
const findSpread = (sides, measure) =>
  sides.find((side) => side.pitcher?.starters?.values)?.pitcher.starters.values[measure.key] ??
  null;

/**
 * Where a starter not ranked would rank in a measure, once he's nearly qualified, or null.
 * @param {any} side
 * @param {(typeof TAPE)[number]} measure
 * @param {number[] | null} values
 * @param {number | null} progress his share of the innings qualifying takes
 */
function findWouldRank(side, measure, values, progress) {
  const value = side.pitcher?.line?.[measure.key];
  if (side.pitcher?.ranks || !values?.length || value == null) return null;
  const { isFewestFirst } = measure;
  return (
    rankAmong(values, Number(value), { isRanked: false, isFewestFirst, progress }).wouldRank ?? null
  );
}

/**
 * Every qualified starter's number in a measure, smoothed into a curve, with a mark for each
 * ranked starter, and a line where a starter would rank once he's nearly qualified.
 * @param {any[]} sides
 * @param {(typeof TAPE)[number]} measure
 * @param {number[] | null} values
 * @param {(number | null)[]} wouldRanks
 */
function renderCurve(sides, measure, values, wouldRanks) {
  if (!values?.length) return html`<span class="player-curve"></span>`;
  const isMarked = (/** @type {any} */ side, /** @type {number} */ index) =>
    side.pitcher?.line?.[measure.key] != null &&
    (Boolean(side.pitcher.ranks?.[measure.key]) || wouldRanks[index] != null);
  const marks = sides.filter(isMarked).map((side) => ({
    value: Number(side.pitcher.line[measure.key]),
    className: side.key,
    isProvisional: !side.pitcher.ranks?.[measure.key],
  }));
  return renderSpreadCurve(values, marks, measure.isFewestFirst);
}

/**
 * @param {any[]} sides
 * @param {(typeof TAPE)[number]} measure
 * @param {(number | null)[]} progresses each starter's share of the innings qualifying takes
 */
function renderMeasure(sides, measure, progresses) {
  const [away, home] = findStandings(sides, measure);
  const values = findSpread(sides, measure);
  const wouldRanks = sides.map((side, index) =>
    findWouldRank(side, measure, values, progresses[index]),
  );
  return html`<div class="tape-measure">
    <div class="tape-numbers">
      ${renderNumber(sides[0], measure, away, wouldRanks[0])}
      <span class="tape-label">${measure.label}</span>
      ${renderNumber(sides[1], measure, home, wouldRanks[1])}
    </div>
    ${renderCurve(sides, measure, values, wouldRanks)}
  </div>`;
}

const isUnranked = (side) => Boolean(side.pitcher?.line && !side.pitcher.ranks);

/**
 * @param {any[]} sides
 * @param {(club: string) => number | null} countClubGames
 */
function renderTapeNotes(sides, countClubGames) {
  const fewestFirst = TAPE.filter((measure) => measure.isFewestFirst).map(
    (measure) => measure.label,
  );
  const rankNote =
    sides.some((side) => side.pitcher?.ranks) &&
    html`<p class="tape-note">Rank among qualified starters</p>`;
  const fewestNote = html`<p class="tape-note">${describeFewestFirst(fewestFirst)}</p>`;
  const unrankedNotes = sides
    .filter(isUnranked)
    .map(
      ({ pitcher, club }) =>
        html`<p class="tape-note">${describeInningsToQualify(pitcher.lastName, pitcher.line.ip, countClubGames(club))}</p>`,
    );
  return html`${rankNote}${fewestNote}${unrankedNotes}`;
}

/**
 * @param {any[]} sides
 * @param {(club: string) => number | null} countClubGames
 */
function renderTape(sides, countClubGames) {
  const isLoaded = sides.some((side) => side.pitcher?.line);
  if (!isLoaded && !sides.some(isLoadingPitcher)) return html``;
  const notes = isLoaded
    ? renderTapeNotes(sides, countClubGames)
    : html`<p class="tape-note">${renderPlaceholder("Rank among qualified starters")}</p>`;
  const progresses = sides.map((side) =>
    isUnranked(side)
      ? measureInningsProgress(side.pitcher.line.ip, countClubGames(side.club))
      : null,
  );
  return html`<div class="tape" style="${formatSideColors(sides)}">
    ${TAPE.map((measure) => renderMeasure(sides, measure, progresses))}
    ${notes}
  </div>`;
}

const formatStartDay = (date) => formatShortDate(readCalendarDate(date));

const isUnderWay = (start, side, game) =>
  game.state === "live" && start.date === game.date && start.opp === side.opponent;

const isToday = (date) => date === readEasternDay(Date.now()).date;

// A start still adding up says Now while he pitches, and once he's pulled, Today, like any other
// start from today.
function renderStartDay(start, side, game) {
  const isUnderWayStart = isUnderWay(start, side, game);
  if (isUnderWayStart && side.starter?.pitching) return html`<span class="start-now">Now</span>`;
  if (isUnderWayStart || isToday(start.date)) return html`<span>Today</span>`;
  return html`<span class="tabular">${formatStartDay(start.date)}</span>`;
}

function renderStart(start, side, game) {
  const opponent = start.opp ? `${start.home ? "vs" : "@"} ${nameTeam(start.opp)}` : "";
  const line = describeGamePitching({
    innings: start.ip,
    pitches: start.pitches,
    runs: start.runs,
    strikeOuts: start.k,
  });
  return html`<li>${renderStartDay(start, side, game)}<span>${opponent}</span><span class="tabular">${line}</span></li>`;
}

function describeRest(rest) {
  if (rest === 1) return "1 day's rest";
  return `${rest} days' rest`;
}

function renderRotationStarter(starter) {
  const { start } = starter;
  const pitches = start.pitches != null ? `, ${start.pitches} pitches` : "";
  const isRested = starter.rest >= USUAL_REST_DAYS;
  return html`<li class="${isRested ? "rested" : ""}">
    <span class="rotation-name"><span>${starter.name}</span>${renderArm(starter.hand)}</span>
    <span class="tabular">${formatInnings(start.ip)} IP${pitches}</span>
    <span class="tabular">${describeRest(starter.rest)}</span>
  </li>`;
}

const renderPendingRotationStarter = () =>
  html`<li>
    <span class="rotation-name">${renderPlaceholder("Lastname")}</span>
    <span>${renderPlaceholder("6 1/3 IP, 98 pitches")}</span>
    <span>${renderPlaceholder("4 days' rest")}</span>
  </li>`;

const isLoadingRotation = (side) => !side.rotation && !side.failure;

function describeRotationNote(side, game) {
  if (isLoadingRotation(side))
    return renderPlaceholder("No starter named yet. Each recent starter");
  if (!side.rotation.starters.length) return "No starts in the last two weeks to go by";
  return `No starter named yet. Each recent starter's last start, and the rest he'd have on ${formatStartDay(game.date)}.`;
}

function renderRotationStarters(side) {
  if (isLoadingRotation(side))
    return Array.from({ length: PENDING_ROTATION }, renderPendingRotationStarter);
  return (side.rotation?.starters || []).map(renderRotationStarter);
}

function renderRotation(side, game) {
  const heading = html`<h3>${renderClubName(side.club)}<span>Who's rested</span></h3>`;
  if (side.failure)
    return html`<section class="scout">
      ${heading}${renderRetryNote("Couldn't load who started lately", "scout-note")}
    </section>`;
  const starters = renderRotationStarters(side);
  const list =
    starters.length > 0 &&
    html`<ul class="rotation">${starters}</ul>
      <p class="tape-note">Gold is a starter's usual rest, ${USUAL_REST_DAYS} days or more</p>`;
  return html`<section class="scout">
    ${heading}
    <p class="scout-note">${describeRotationNote(side, game)}</p>
    ${list}
  </section>`;
}

const isAwaitingStarter = (side, game) =>
  !side.starter && Boolean(side.club) && game.state === "pre" && Boolean(game.today);

// Only a game still to start can yet name a starter worth coming back for.
const isCheckBackSide = (side, game) =>
  game.state === "pre" && !side.starter?.name && !isAwaitingStarter(side, game);

function describeCheckBack(waiting) {
  const [only] = waiting;
  if (waiting.length === 1 && only.club) return `Check back for ${nameTeam(only.club)} pitcher`;
  return "Check back for pitchers";
}

function renderCheckBack(sides, game) {
  const waiting = sides.filter((side) => isCheckBackSide(side, game));
  if (!waiting.length) return html``;
  return html`<p class="check-back">${describeCheckBack(waiting)}</p>`;
}

function renderScouting(side, game, speedRange) {
  if (isAwaitingStarter(side, game)) return renderRotation(side, game);
  if (!side.starter?.name) return html``;
  const name = side.starter.name;
  if (side.failure) return html``;
  if (!side.pitcher) return renderPendingScouting(name);
  const { pitcher } = side;
  const starts =
    pitcher.starts.length &&
    html`<h4>Last starts</h4><ul class="recent-starts">${pitcher.starts.map((start) => renderStart(start, side, game))}</ul>`;
  return html`<section class="scout">
    <h3>${name}<span>What he throws</span></h3>
    ${renderPitchMix(pitcher.pitches, speedRange)}
    ${starts}
  </section>`;
}

const renderPendingStart = () =>
  html`<li>
    <span>${renderPlaceholder("Sep 00")}</span>
    <span>${renderPlaceholder("vs Mariners")}</span>
    <span>${renderPlaceholder("5 2/3 IP, 2 R, 6 K")}</span>
  </li>`;

function renderPendingScouting(name) {
  return html`<section class="scout">
    <h3>${name}<span>What he throws</span></h3>
    ${renderPendingPitchMix()}
    <h4>Last starts</h4>
    <ul class="recent-starts">${Array.from({ length: PENDING_STARTS }, renderPendingStart)}</ul>
  </section>`;
}

// Both starters' speed lines share one range, so a dot sits at the same place for the same speed.
const measureSidesSpeedRange = (sides) =>
  measureSpeedRange(sides.filter((side) => side.pitcher).map((side) => side.pitcher.pitches));

/**
 * The sides that read something for the section: a named starter's numbers, or the last starters
 * of a club yet to name one.
 * @param {any[]} sides
 * @param {MatchupGame} game
 */
const listReadingSides = (sides, game) =>
  sides.filter((side) => Boolean(side.starter?.name) || isAwaitingStarter(side, game));

/**
 * @param {any[]} sides
 * @param {MatchupGame} game
 */
function isSectionFailed(sides, game) {
  const reading = listReadingSides(sides, game);
  return reading.length > 0 && reading.every((side) => side.failure);
}

/**
 * What the section couldn't load, as the line under why names it.
 * @param {any[]} failed
 */
function nameSectionFailure(failed) {
  const named = failed.filter((side) => side.starter?.name);
  if (named.length === failed.length)
    return named.length === 1 ? "his numbers" : "starters' numbers";
  if (named.length === 0) return "who started lately";
  return "matchup";
}

/** @param {any[]} failed */
const renderSectionRetry = (failed) =>
  renderRetryBlock(nameSectionFailure(failed), failed[0].failure);

/**
 * @param {MatchupGame} game
 * @param {any[]} sides
 * @param {(club: string) => number | null} countClubGames each club's games so far
 */
export function renderMatchupBody(game, sides, countClubGames) {
  const speedRange = measureSidesSpeedRange(sides);
  const isFailed = isSectionFailed(sides, game);
  const scouting = isFailed
    ? renderSectionRetry(listReadingSides(sides, game))
    : sides.map((side) => renderScouting(side, game, speedRange));
  const isFirstLineShown = sides.some(hasFirstName);
  return html`<div class="faceoff">${sides.map((side) => renderPitcherId(side, isFailed, isFirstLineShown))}</div>
    ${renderCheckBack(sides, game)}
    ${renderTape(sides, countClubGames)}
    ${scouting}`;
}

export const isLoadingSide = (side, game) =>
  isLoadingPitcher(side) || (isAwaitingStarter(side, game) && isLoadingRotation(side));

export const listSides = (game) =>
  SIDES.map((key, index) => ({
    key,
    club: game[key],
    opponent: game[SIDES[1 - index]],
    starter: game.starters?.[index] || null,
    pitcher: null,
    rotation: null,
    failure: null,
  }));

// A starter the store has only by his id, when MLB couldn't describe him, keeps the name shown.
const isNewStarter = (shown, current) =>
  current?.id !== shown?.id || (!!current?.name && !shown?.name);

/**
 * The sides, with a fresh one wherever the game now has another starter, or names one it couldn't.
 * @param {any[]} sides
 * @param {MatchupGame} game
 */
export const updateSides = (sides, game) =>
  listSides(game).map((current, index) =>
    isNewStarter(sides[index].starter, current.starter) ? current : sides[index],
  );

/**
 * @param {any} side
 * @param {MatchupGame} game
 * @param {number} season
 */
export async function loadSide(side, game, season) {
  try {
    if (side.starter?.name) side.pitcher = await fetchPitcher(side.starter.id, season);
    else if (isAwaitingStarter(side, game))
      side.rotation = await fetchRotation(side.club, game.date);
    side.failure = null;
  } catch (error) {
    side.failure = classifyReadFailure(error);
  }
}

/**
 * @typedef {{ id?: string, date: string, start: string, state: string, tbd?: boolean, doubleheader?: number, away: string, home: string, starters?: object[], networks?: string[], today: boolean, series?: string, number?: number }} MatchupGame
 */
