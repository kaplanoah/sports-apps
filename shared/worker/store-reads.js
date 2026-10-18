import { describeError } from "./responses.js";

// What the Worker's routes read from the store, so a tap reads the league only for what the store
// doesn't keep, and count each read of the league the store should have spared.

/**
 * Reads a document from the store, as null when it has none.
 * @typedef {(key: string) => Promise<any>} ReadDoc
 */

/**
 * The documents the store keeps at `keys`, each null when it keeps none, or null for them all
 * when the Worker has no store or the store can't be read, for the route to read the league
 * instead, so a sheet never shows some of what it reads from the store and not the rest.
 * @param {ReadDoc | undefined} readDoc
 * @param {string[]} keys
 * @returns {Promise<any[] | null>}
 */
export async function readKeptDocs(readDoc, keys) {
  if (!readDoc) return null;
  try {
    return await Promise.all(keys.map((key) => readDoc(key)));
  } catch (error) {
    console.error(`Reading ${keys.join(", ")} from the store failed: ${describeError(error)}`);
    return null;
  }
}

/**
 * The document the store keeps at `key`, or null when it keeps none, the Worker has no store, or
 * the store can't be read.
 * @param {ReadDoc | undefined} readDoc
 * @param {string} key
 */
export const readKeptDoc = async (readDoc, key) =>
  (await readKeptDocs(readDoc, [key]))?.[0] ?? null;

/**
 * The documents the store keeps at `keys` for `season`, as `readKeptDocs` reads them, and whether
 * `season` is the store's current one. Only the current season's reads of the league are counted,
 * since the store keeps it as it goes, while a season it never kept is read from the league by
 * design.
 * @param {ReadDoc | undefined} readDoc
 * @param {number} season
 * @param {string[]} keys
 * @returns {Promise<{ docs: any[] | null, isCurrentSeason: boolean }>}
 */
export async function readSeasonDocs(readDoc, season, keys) {
  const kept = await readKeptDocs(readDoc, [...keys, "live/current"]);
  if (!kept) return { docs: null, isCurrentSeason: false };
  return { docs: kept.slice(0, -1), isCurrentSeason: season === kept.at(-1)?.season };
}

/**
 * Counts a read of the league the store should have spared, which never holds up the sheet.
 * @param {string} what what was read, as an error names it
 * @param {() => Promise<void>} countLeagueRead
 */
export async function noteLeagueRead(what, countLeagueRead) {
  try {
    await countLeagueRead();
  } catch (error) {
    console.error(`Counting ${what} read from the league failed: ${describeError(error)}`);
  }
}
