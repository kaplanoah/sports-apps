// Standings arithmetic on the app's stored rows.
// Shared with the Worker without DOM or globals.

const SEASON_GAMES = 162;

/**
 * A club's games this regular season: those MLB schedules it for, less any it called off for good,
 * as a rainout never made up is, or the usual 162 where the season's schedule isn't known.
 * @param {{ scheduled?: number }} row its standings row
 */
export const countSeasonGames = (row) => row.scheduled ?? SEASON_GAMES;

const hasPlayedOut = (row) => row.w + row.l >= countSeasonGames(row);

// MLB's divisionChamp and its "y" marker have both named a wild card club, so a division is
// won only once every other club in it is out of the division race. A tie at the end is
// broken on paper, and MLB then names only the winner the leader but never eliminates the
// other club.
const isOutOfDivisionRace = (other, leader) =>
  other.elim === "E" || (!other.lead && hasPlayedOut(other) && hasPlayedOut(leader));

export const hasWonDivision = (row, divisionRows) =>
  row.lead && divisionRows.every((other) => other.id === row.id || isOutOfDivisionRace(other, row));

// MLB gives a club tied for the lead "-" instead of an elimination number, so a tie is
// counted the way MLB counts the rest: a tie at the end doesn't clinch.
function countEliminationNumber(leader, chaser) {
  const given = Number(chaser.elim);
  if (Number.isFinite(given)) return given;
  if (chaser.elim !== "-") return null;
  return countSeasonGames(chaser) + 1 - leader.w - chaser.l;
}

// The division magic number is the closest chaser's elimination number; MLB's
// `magicNumber` counts toward a playoff spot instead.
function setMagicNumber(rows) {
  const leader = rows.find((row) => row.lead);
  if (!leader || leader.clinched) return;
  const chasers = rows
    .filter((row) => row !== leader)
    .map((row) => countEliminationNumber(leader, row))
    .filter(Number.isFinite);
  if (chasers.length) leader.magic = String(Math.min(...chasers));
}

/**
 * Each division's rows with whether its leader has won it and the leader's magic number, from
 * each club's record and its season's games.
 * @param {Record<string, any[]>} divisions each division's rows, in the order of its standings
 * @returns {Record<string, any[]>}
 */
export function settleDivisionRaces(divisions) {
  return Object.fromEntries(
    Object.entries(divisions).map(([name, divisionRows]) => {
      const rows = divisionRows.map((row) => ({ ...row, magic: null }));
      for (const row of rows) row.clinched = hasWonDivision(row, rows);
      setMagicNumber(rows);
      return [name, rows];
    }),
  );
}
