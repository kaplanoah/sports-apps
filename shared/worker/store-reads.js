import { describeError } from "./responses.js";

// Documents read by store-owned detail services. A storage failure stops the read.

/**
 * Reads a document from the store, as null when it has none.
 * @typedef {(key: string) => Promise<any>} ReadDoc
 */

/**
 * The documents the store keeps at `keys`, each null when it keeps none, or null for them all
 * when no reader is supplied. Storage errors propagate to the store-owned service.
 * @param {ReadDoc | undefined} readDoc
 * @param {string[]} keys
 * @returns {Promise<any[] | null>}
 */
async function readKeptDocs(readDoc, keys) {
  if (!readDoc) return null;
  return Promise.all(keys.map((key) => readDoc(key)));
}

/**
 * The document the store keeps at `key`, or null when it keeps none or no reader is supplied.
 * @param {ReadDoc | undefined} readDoc
 * @param {string} key
 */
export const readKeptDoc = async (readDoc, key) =>
  (await readKeptDocs(readDoc, [key]))?.[0] ?? null;

/**
 * The documents the store keeps at `keys` for `season`, as `readKeptDocs` reads them, and whether
 * `season` is the store's current one.
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
