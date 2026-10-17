import { session } from "./session.js";
import { countSeasonGames } from "./snapshot.js";

const isAhead = (gamesBack) => gamesBack === "-" || String(gamesBack).startsWith("+");

/**
 * @param {{ gb?: string, wcgb?: string, elim?: string, wce?: string, magic?: string | null,
 *   clinch?: string | null, clinched?: boolean, lead?: boolean, wcrank?: string | null } | null} row
 * @returns {{ label: string | null, standing: "clinched" | "racing" | "out" } | null}
 */
export function describeRace(row) {
  if (!row || !row.gb) return null;
  // MLB's own letter: z best record in the league, y division, w wild card, x a playoff spot.
  if (row.clinch) return { label: row.clinch, standing: "clinched" };
  if (row.clinched) return { label: "y", standing: "clinched" };
  if (row.lead) return { label: row.magic ? `M#${row.magic}` : "1st", standing: "racing" };
  if (row.elim !== "E") {
    return { label: row.gb === "-" ? "Tied" : `${row.gb} GB`, standing: "racing" };
  }
  if (row.wce !== "E") {
    const label = isAhead(row.wcgb) ? `WC${row.wcrank}` : `${row.wcgb} WC`;
    return { label, standing: "racing" };
  }
  return { label: null, standing: "out" };
}

const listDivisions = () =>
  Object.entries((session.standings && session.standings.divisions) || {});

export function findStandingsRow(id) {
  return listDivisions()
    .flatMap(([, rows]) => rows)
    .find((row) => row.id === id);
}

const countMostWins = (row) => countSeasonGames(row) - Number(row.l);

// The fewest and most wins the division's eventual winner can finish with.
function findDivisionWinnerRange(rows) {
  const alive = rows.filter((row) => row.elim !== "E");
  return {
    least: Math.max(...alive.map((row) => Number(row.w))),
    most: Math.max(...alive.map(countMostWins)),
  };
}

// A possible tie counts as open, since the tiebreaker can go either way.
const isSettledAgainst = (row, range) =>
  Number(row.w) > range.most || range.least > countMostWins(row);

const findWinRange = (row) => ({ least: Number(row.w), most: countMostWins(row) });

function isDivisionSeedFinal(row, league, division) {
  return listDivisions()
    .filter(([name]) => name.startsWith(league) && name !== division)
    .every(([, rows]) => isSettledAgainst(row, findDivisionWinnerRange(rows)));
}

// Clubs that could still finish among the wild cards: in, still alive for one, or leading a
// division they could yet lose.
function listWildCardRivals(row, league) {
  return listDivisions()
    .filter(([name]) => name.startsWith(league))
    .flatMap(([, rows]) => rows)
    .filter((other) => other !== row && !other.clinched)
    .filter((other) => other.clinch || other.wce !== "E" || other.lead);
}

const isWildCardSeedFinal = (row, league) =>
  listWildCardRivals(row, league).every((other) => isSettledAgainst(row, findWinRange(other)));

export function isSeedFinal(id) {
  const { state } = session;
  if (!state || !state.teams || !state.teams[id]) return false;
  if (state.projected === false) return true;
  const found = listDivisions().find(([, rows]) => rows.some((row) => row.id === id));
  if (!found) return false;
  const [division, rows] = found;
  const row = rows.find((candidate) => candidate.id === id);
  const league = division.slice(0, 2);
  if (row.clinched) return isDivisionSeedFinal(row, league, division);
  if (row.clinch === "w") return isWildCardSeedFinal(row, league);
  return false;
}
