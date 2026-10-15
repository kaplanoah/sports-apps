import { describeSeriesLead } from "#shared/series-text.js";
import { TEAMS } from "./teams.js";

/** @typedef {{ team: string, seed: number | null, wins: number }} SeriesSide */
/** @typedef {{ id: string, round: number, top: SeriesSide | null, bottom: SeriesSide | null, winner: string | null, status: string, nextGame: { id: string, start: string | null } | null }} Series */

// The bracket pairs the 1-8 and 4-5 series' winners in one semifinal, and 2-7 and 3-6 in the other.
export const BRACKET_ORDER = {
  1: ["1-0", "1-3", "1-1", "1-2"],
  2: ["2-0", "2-1"],
  3: ["3-0"],
};

/** The two series whose winners meet in each later one, upper first. */
export const BRACKET_FEEDERS = {
  "2-0": ["1-0", "1-3"],
  "2-1": ["1-1", "1-2"],
  "3-0": ["2-0", "2-1"],
};

/** @param {string | null} code */
export const nameTeam = (code) => (code && TEAMS[code]?.name) || "TBD";

/**
 * A series' two sides, the one with more wins first.
 * @param {SeriesSide} top
 * @param {SeriesSide} bottom
 */
export const orderBySeriesWins = (top, bottom) =>
  top.wins >= bottom.wins ? [top, bottom] : [bottom, top];

/**
 * Where a series stands, as "Dream lead 1-0", "Tied 1-1", or "Liberty win 2-0".
 * @param {Series | undefined} series
 */
export function describeSeriesStanding(series) {
  if (!series?.top || !series.bottom) return "";
  const [ahead, behind] = orderBySeriesWins(series.top, series.bottom);
  return describeSeriesLead({
    leader: nameTeam(ahead.team),
    wins: ahead.wins,
    losses: behind.wins,
    isOver: !!series.winner,
  });
}

const FINALS_ROUND = 3;

/**
 * Whether the playoffs are over, with the Finals won.
 * @param {Series[]} allSeries
 */
export const isPlayoffsOver = (allSeries) =>
  allSeries.some((series) => series.round === FINALS_ROUND && !!series.winner);

/**
 * How far each team got: its seed, the round it's playing or went out in, and whether it won it
 * all.
 * @param {Series[]} allSeries
 * @returns {Map<string, { seed: number | null, round: number, isOut: boolean, isChampion: boolean }>}
 */
export function readPlayoffRuns(allSeries) {
  const runs = new Map();
  const byRound = [...allSeries].sort((first, second) => first.round - second.round);
  for (const series of byRound) {
    for (const side of [series.top, series.bottom]) {
      if (!side?.team) continue;
      const isOut = !!series.winner && series.winner !== side.team;
      const isChampion = series.round === FINALS_ROUND && series.winner === side.team;
      runs.set(side.team, { seed: side.seed, round: series.round, isOut, isChampion });
    }
  }
  return runs;
}

/**
 * Whether a team still has games to play this season: every team until the playoff field is set,
 * then a team in the field until it goes out or wins it all.
 * @param {Series[]} allSeries
 * @param {string} team
 */
export function isStillPlaying(allSeries, team) {
  const runs = readPlayoffRuns(allSeries);
  if (!runs.size) return true;
  const run = runs.get(team);
  return !!run && !run.isOut && !run.isChampion;
}
