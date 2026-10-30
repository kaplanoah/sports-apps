// The app's postseason format and bracket.
// Shared with the Worker without DOM or globals.

export const LEAGUES = ["AL", "NL"];
export const BEST_OF = { WC: 3, DS: 5, CS: 7, WS: 7 };
export const countWinsNeeded = (round) => Math.ceil(BEST_OF[round] / 2);

/** @param {string} seriesId */
export function readSeriesFacts(seriesId) {
  const match = /^(?:(AL|NL)_)?(WC|DS|CS|WS)\d?$/.exec(seriesId);
  return match ? { league: match[1] ?? null, round: match[2] } : {};
}

/** @param {string} seriesId */
export const readSeriesRound = (seriesId) => readSeriesFacts(seriesId).round;

/** @param {string} seriesId */
export const countSeriesWinsNeeded = (seriesId) => countWinsNeeded(readSeriesRound(seriesId));

// The bracket is fixed, not reseeded: 1 draws the 4/5 winner, 2 the 3/6.
const LEAGUE_SERIES = [
  { key: "WC1", round: "WC", sides: [{ seed: 3 }, { seed: 6 }] },
  { key: "WC2", round: "WC", sides: [{ seed: 4 }, { seed: 5 }] },
  { key: "DS1", round: "DS", sides: [{ seed: 1 }, { winnerOf: "WC2" }] },
  { key: "DS2", round: "DS", sides: [{ seed: 2 }, { winnerOf: "WC1" }] },
  { key: "CS", round: "CS", sides: [{ winnerOf: "DS1" }, { winnerOf: "DS2" }] },
];

/**
 * Walks the bracket in playing order. `decideWinner` names each series' winner, or null.
 * @param {Record<string, { league: string, seed: number }>} teams
 * @param {(seriesId: string, round: string, teamA: string | null, teamB: string | null) => string | null} decideWinner
 */
export function resolveBracket(teams, decideWinner) {
  const holderOfSeed = {};
  for (const [id, team] of Object.entries(teams)) holderOfSeed[`${team.league}${team.seed}`] = id;
  const bracket = {};
  const findWinner = (seriesId) => (bracket[seriesId] ? bracket[seriesId].winner : null);
  const settleSeries = (id, round, teamA, teamB) => {
    bracket[id] = { id, round, teamA, teamB, winner: decideWinner(id, round, teamA, teamB) };
  };
  for (const league of LEAGUES) {
    for (const { key, round, sides } of LEAGUE_SERIES) {
      const [teamA, teamB] = sides.map((side) =>
        side.seed
          ? holderOfSeed[`${league}${side.seed}`] || null
          : findWinner(`${league}_${side.winnerOf}`),
      );
      settleSeries(`${league}_${key}`, round, teamA, teamB);
    }
  }
  settleSeries("WS", "WS", findWinner("AL_CS"), findWinner("NL_CS"));
  return bracket;
}

// `side` is 0 for teamA and 1 for teamB.
export function findFeederSeries(seriesId, side) {
  if (seriesId === "WS") return side === 0 ? "AL_CS" : "NL_CS";
  const [league, key] = seriesId.split("_");
  const series = LEAGUE_SERIES.find((candidate) => candidate.key === key);
  const winnerOf = series && series.sides[side].winnerOf;
  return winnerOf ? `${league}_${winnerOf}` : null;
}
