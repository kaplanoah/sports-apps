// A team's numbers measured against every team's, as a team's sheet shows them: its regular season
// on curves of every team's (rank-curve.js), and its playoffs as dots on lines across the regular
// season's ranges, beside the playoff field's, so a playoff number reads as high or low for the
// league, each line dashed past its range as far as a playoff number reaches, with a legend saying
// so. Each league hands it its measures, how it writes each, and every team's numbers in one shape:
// what a team scored and allowed a game, its margin a game, and its records at home and on the
// road.

import { html } from "./html.js";
import { placeOnRange, rankAmong, renderPlacedRow, renderRankRow } from "./rank-curve.js";

/**
 * A team's numbers through a stretch of games, as its record and its averages a game.
 * @typedef {{ record: string | null, scored: number | null, allowed: number | null, margin: number | null, home: string | null, road: string | null }} PhaseStats
 */
/**
 * A measure a team's numbers show: a record like 15-7, ranked and placed by the share of its games
 * won, or a number written with `format`.
 * @typedef {{ label: string, key: "scored" | "allowed" | "margin" | "home" | "road", format?: (value: number) => string, isFewestFirst?: boolean }} Measure
 */
/** @typedef {{ own: number, theirs: number, isHome: boolean }} TeamGame */

/**
 * The share of its games a record won, or null for a record of no games.
 * @param {string | null | undefined} record as 15-7
 */
export function readWinShare(record) {
  const [wins, losses] = String(record ?? "")
    .split("-")
    .map(Number);
  const games = wins + losses;
  return games > 0 ? wins / games : null;
}

/**
 * A margin with its sign, to `digits` places, or no sign when it rounds to nothing.
 * @param {number} margin
 * @param {number} digits
 */
export function formatMargin(margin, digits) {
  const shown = margin.toFixed(digits);
  if (Number(shown) === 0) return (0).toFixed(digits);
  return margin > 0 ? `+${shown}` : shown;
}

/**
 * @param {PhaseStats} stats
 * @param {Measure} measure
 * @returns {number | null}
 */
function readMeasure(stats, measure) {
  const value = stats[measure.key];
  if (value == null) return null;
  return measure.format ? Number(value) : readWinShare(String(value));
}

/**
 * @param {PhaseStats} stats
 * @param {Measure} measure
 * @returns {string | null}
 */
function showMeasure(stats, measure) {
  const value = stats[measure.key];
  if (value == null) return null;
  return measure.format ? measure.format(Number(value)) : String(value);
}

/**
 * Every team's number in a measure, leaving out a team without one.
 * @param {PhaseStats[]} teams
 * @param {Measure} measure
 */
const listMeasure = (teams, measure) =>
  /** @type {number[]} */ (
    teams.map((team) => readMeasure(team, measure)).filter((value) => value != null)
  );

/**
 * The lowest and highest any team reached in a measure, or no wins to all of them for a record.
 * @param {PhaseStats[]} teams
 * @param {Measure} measure
 * @returns {[number, number] | null}
 */
function readRange(teams, measure) {
  if (!measure.format) return [0, 1];
  const values = listMeasure(teams, measure);
  return values.length > 0 ? [Math.min(...values), Math.max(...values)] : null;
}

/**
 * A team's regular season ranked among every team's, a row for each measure it has a number in.
 * @param {Measure[]} measures
 * @param {PhaseStats} team
 * @param {PhaseStats[]} teams
 */
export const listSeasonRankRows = (measures, team, teams) =>
  measures
    .filter((measure) => readMeasure(team, measure) != null)
    .map((measure) =>
      renderRankRow({
        label: measure.label,
        shown: showMeasure(team, measure) ?? "",
        stat: rankAmong(listMeasure(teams, measure), readMeasure(team, measure), {
          isRanked: true,
          isFewestFirst: measure.isFewestFirst,
        }),
        isFewestFirst: measure.isFewestFirst,
      }),
    );

/**
 * The measures a team's playoffs have a number in.
 * @param {Measure[]} measures
 * @param {PhaseStats} team
 */
const listShownMeasures = (measures, team) =>
  measures.filter((measure) => showMeasure(team, measure) != null);

/**
 * A measure's line for a team's playoffs: the regular season's range of every team's, and the span
 * the line runs across, the same range stretched only as far as the team's or the field's playoff
 * number reaches past it, or null for both when no team has a number in the measure.
 * @param {Measure} measure
 * @param {PhaseStats} team
 * @param {PhaseStats | null} field
 * @param {PhaseStats[]} teams every team's regular season
 */
function readFieldLine(measure, team, field, teams) {
  const range = readRange(teams, measure);
  const values = [team, field]
    .map((stats) => stats && readMeasure(stats, measure))
    .filter((value) => value != null);
  /** @type {[number, number] | null} */
  const span = range && [Math.min(range[0], ...values), Math.max(range[1], ...values)];
  return { range, span };
}

/**
 * Whether a line reaches past the regular season's range.
 * @param {ReturnType<typeof readFieldLine>} line
 */
const isPastRange = ({ range, span }) =>
  range != null && span != null && (span[0] < range[0] || span[1] > range[1]);

/**
 * A team's playoff numbers across from the playoff field's, each measure a dot for each on a line
 * solid across the regular season's range of every team's, and dashed past it as far as either
 * number reaches.
 * @param {Measure[]} measures
 * @param {PhaseStats} team
 * @param {PhaseStats | null} field
 * @param {PhaseStats[]} teams every team's regular season
 */
export const listFieldRows = (measures, team, field, teams) =>
  listShownMeasures(measures, team).map((measure) => {
    const { range, span } = readFieldLine(measure, team, field, teams);
    /** @param {number | null} value */
    const placeOnSpan = (value) => placeOnRange(value, span, measure.isFewestFirst);
    /** @param {PhaseStats | null} stats */
    const place = (stats) => ({
      shown: (stats && showMeasure(stats, measure)) ?? "",
      at: stats && placeOnSpan(readMeasure(stats, measure)),
    });
    return renderPlacedRow({
      label: measure.label,
      own: place(team),
      other: place(field),
      range: placeRangeOnLine(range, placeOnSpan),
    });
  });

/**
 * Where the regular season's range starts and ends on its line, from 0 to 100, or nothing when the
 * line has no span to place it on.
 * @param {[number, number] | null} range
 * @param {(value: number) => number | null} placeOnSpan
 * @returns {[number, number] | undefined}
 */
function placeRangeOnLine(range, placeOnSpan) {
  const ends = (range ?? []).map(placeOnSpan);
  if (ends.length !== 2 || ends.includes(null)) return undefined;
  const [start, end] = /** @type {number[]} */ (ends).sort((first, second) => first - second);
  return [start, end];
}

const FIELD_LEGEND = [
  ["range", "Regular season range for all teams"],
  ["past", "Playoffs range, beyond regular season range"],
];

/**
 * What a team's playoff lines' solid and dashed stretches mean, once a line reaches past the
 * regular season's range, or nothing while every line stays on it.
 * @param {Measure[]} measures
 * @param {PhaseStats} team
 * @param {PhaseStats | null} field
 * @param {PhaseStats[]} teams every team's regular season
 */
export function renderFieldLegend(measures, team, field, teams) {
  const isPast = listShownMeasures(measures, team).some((measure) =>
    isPastRange(readFieldLine(measure, team, field, teams)),
  );
  return (
    isPast &&
    html`<p class="placed-legend">${FIELD_LEGEND.map(
      ([kind, label]) =>
        html`<span class="placed-key"><span class="placed-swatch ${kind}"></span>${label}</span>`,
    )}</p>`
  );
}

/** @param {boolean[]} results each game's, true for a win */
function formatRecord(results) {
  const wins = results.filter(Boolean).length;
  return `${wins}-${results.length - wins}`;
}

/** @param {number[]} values */
const averageOf = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * A team's numbers through the games it has finished, or null before its first.
 * @param {TeamGame[]} games
 * @returns {PhaseStats | null}
 */
export function describeTeamGames(games) {
  if (!games.length) return null;
  /** @param {TeamGame[]} some */
  const recordOf = (some) => formatRecord(some.map((game) => game.own > game.theirs));
  const scored = averageOf(games.map((game) => game.own));
  const allowed = averageOf(games.map((game) => game.theirs));
  return {
    record: recordOf(games),
    scored,
    allowed,
    margin: scored - allowed,
    home: recordOf(games.filter((game) => game.isHome)),
    road: recordOf(games.filter((game) => !game.isHome)),
  };
}

/**
 * The playoffs so far, as one side to measure a team against: what each team scored a game, and
 * how home teams and road teams have done, or null before the first game ends.
 * @param {{ home: number, away: number }[]} scores each finished game's
 * @returns {PhaseStats | null}
 */
export function describePlayoffField(scores) {
  if (!scores.length) return null;
  const scored = averageOf(scores.flatMap((score) => [score.home, score.away]));
  const homeWins = scores.filter((score) => score.home > score.away).length;
  const roadWins = scores.length - homeWins;
  return {
    record: null,
    scored,
    allowed: scored,
    margin: 0,
    home: `${homeWins}-${roadWins}`,
    road: `${roadWins}-${homeWins}`,
  };
}
