// How near a player is to qualifying for MLB's ranks: a starter with an inning for each of his
// club's games, and a hitter with 3.1 plate appearances for each.

import { session } from "./session.js";
import { countOuts, formatInnings } from "./stat-table.js";

const PLATE_APPEARANCES_PER_GAME = 3.1;

/**
 * A club's games in the season the page shows, from its standings, or null for another season.
 * @param {string} club
 * @param {number} season
 */
export function countClubGames(club, season) {
  if (season !== session.activeYear) return null;
  const rows = Object.values(session.standings?.divisions ?? {}).flat();
  const row = rows.find((each) => each.id === club);
  return row ? row.w + row.l : null;
}

/**
 * The plate appearances a hitter needs to qualify, after his club's games.
 * @param {number} clubGames
 */
export const countPlateAppearancesNeeded = (clubGames) =>
  Math.round(clubGames * PLATE_APPEARANCES_PER_GAME);

/**
 * Whether a pitcher has pitched an inning for each of his club's games.
 * @param {string | null | undefined} innings as MLB writes them, like 28.1
 * @param {number} clubGames
 */
export const hasInningsToQualify = (innings, clubGames) => countOuts(innings) >= clubGames * 3;

/**
 * Innings as MLB writes them, like 28.1 for 28 and a third, as a number.
 * @param {string | number} innings
 */
export function readInnings(innings) {
  const [whole, thirds = "0"] = String(innings).split(".");
  return Number(whole) + Number(thirds) / 3;
}

/**
 * A starter's innings as a share of the inning a game his club's games ask for, or null when
 * either isn't known.
 * @param {string | null | undefined} innings as MLB writes them, like 28.1
 * @param {number | null} clubGames
 */
export const measureInningsProgress = (innings, clubGames) =>
  innings == null || !clubGames ? null : readInnings(innings) / clubGames;

/**
 * A hitter's plate appearances as a share of the 3.1 a game his club's games ask for, or null
 * when its games aren't known.
 * @param {number} plateAppearances
 * @param {number | null} clubGames
 */
export const measurePlateAppearancesProgress = (plateAppearances, clubGames) =>
  !clubGames ? null : plateAppearances / (clubGames * PLATE_APPEARANCES_PER_GAME);

/**
 * The innings a starter has pitched against those he needs, or that he needs more when either
 * isn't known.
 * @param {string} subject his last name, or He
 * @param {string | null | undefined} innings as MLB writes them, like 28.1
 * @param {number | null} clubGames
 */
export function describeInningsToQualify(subject, innings, clubGames) {
  if (innings == null || clubGames == null)
    return `${subject} hasn't pitched the innings needed to qualify`;
  return `${subject} has pitched ${formatInnings(innings)} of the ${clubGames} innings needed to qualify`;
}

/**
 * The plate appearances a hitter has had against those he needs, or that he needs more when his
 * club's games aren't known.
 * @param {number} plateAppearances
 * @param {number | null} clubGames
 */
export function describePlateAppearancesToQualify(plateAppearances, clubGames) {
  if (clubGames == null) return "He hasn't had the plate appearances needed to qualify";
  const needed = countPlateAppearancesNeeded(clubGames);
  return `He has ${plateAppearances} of the ${needed} plate appearances needed to qualify`;
}
