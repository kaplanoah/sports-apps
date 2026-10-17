// Who counts as a starter, as a club's Roster and a player's sheet tell, and the numbers a starter
// is ranked in among MLB's qualified starters, as his matchup and his own sheet show them: each
// one's label, how it's written, and whether it ranks from the fewest.

import { NO_NUMBER } from "./stat-table.js";

/**
 * A pitcher who has started at least half the games he has pitched in.
 * @param {any} pitching his season's pitching line
 */
export const isStarter = (pitching) =>
  (pitching?.gamesStarted ?? 0) > 0 && pitching.gamesStarted * 2 >= pitching.gamesPlayed;

/**
 * @typedef {{ key: "era" | "k9" | "bb9" | "speed", label: string, write: (value: number) => string, isFewestFirst?: boolean }} StarterMeasure
 */

/** @type {StarterMeasure[]} */
export const STARTER_MEASURES = [
  { key: "era", label: "ERA", write: (value) => value.toFixed(2), isFewestFirst: true },
  { key: "k9", label: "K/9", write: (value) => value.toFixed(1) },
  { key: "bb9", label: "BB/9", write: (value) => value.toFixed(1), isFewestFirst: true },
  { key: "speed", label: "Velo", write: (value) => value.toFixed(1) },
];

/**
 * A starter's number in a measure as it's shown, or the mark of no number where his line holds
 * none MLB counted.
 * @param {StarterMeasure} measure
 * @param {Record<string, unknown>} line
 */
export function formatStarterMeasure(measure, line) {
  const value = Number(line[measure.key]);
  return Number.isFinite(value) ? measure.write(value) : NO_NUMBER;
}

/** The labels of the measures ranked from the fewest, which a starter's notes name. */
export const FEWEST_FIRST_LABELS = STARTER_MEASURES.filter((measure) => measure.isFewestFirst).map(
  (measure) => measure.label,
);
