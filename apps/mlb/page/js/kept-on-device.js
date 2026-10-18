// What this device keeps for each season: its ranking, and when its Updates box counts from.

import { createViewerChoice } from "#shared/device-storage.js";
import { watchNoteDismissals } from "#shared/updates.js";

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * @param {unknown} stored
 * @returns {Record<string, unknown>}
 */
const readSeasons = (stored) =>
  isPlainObject(stored) ? /** @type {Record<string, unknown>} */ (stored) : {};

const rankings = createViewerChoice("rankings", readSeasons);
const seenAtBySeason = createViewerChoice("updatesSeenAt", readSeasons);

/**
 * The clubs this device dragged into order for a season, or none before its first drag.
 * @param {number} year
 * @returns {string[]}
 */
export function readRanking(year) {
  const ranking = rankings.read()[year];
  return Array.isArray(ranking) ? ranking.filter((id) => typeof id === "string") : [];
}

/**
 * @param {number} year
 * @param {string[]} order
 */
export const keepRanking = (year, order) => rankings.keep({ ...rankings.read(), [year]: order });

/**
 * When a season's Updates box counts from on this device, its last dismissal or its first look:
 * 0 for a season it has kept none for, whose updates are all new to it, or null on a device that
 * has kept none for any season, which is new to the app.
 * @param {number} year
 * @returns {number | null}
 */
export function readSeenAt(year) {
  const seasons = seenAtBySeason.read();
  const seenAt = seasons[year];
  if (typeof seenAt === "number" && seenAt > 0) return seenAt;
  return Object.keys(seasons).length ? 0 : null;
}

/**
 * @param {number} year
 * @param {number} at
 */
export const keepSeenAt = (year, at) =>
  seenAtBySeason.keep({ ...seenAtBySeason.read(), [year]: at });

/**
 * Calls `onChange` whenever this device's ranking, when its Updates box counts from, or its release
 * notes' dismissal changes, in this tab or another.
 * @param {() => void} onChange
 */
export function watchKeptChoices(onChange) {
  rankings.watch(onChange);
  seenAtBySeason.watch(onChange);
  watchNoteDismissals(onChange);
}
