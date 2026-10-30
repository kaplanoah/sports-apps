import { NOT_AVAILABLE_YET, NOT_AVAILABLE_TITLE } from "../page/worker-error.js";
import { describeError, respondError } from "./responses.js";

// Documents read by store-owned detail services. A storage failure stops the read.

/**
 * Reads a document from the store, as null when it has none.
 * @typedef {(key: string) => Promise<any>} ReadDoc
 */

/**
 * The document the store keeps at `key`, or null when it keeps none.
 * @param {ReadDoc} readDoc
 * @param {string} key
 */
export const readKeptDoc = async (readDoc, key) => (await readDoc(key)) ?? null;

/**
 * Reads the season's documents and availability from one current-season read. The first document
 * establishes whether that season's requested data has been filled.
 * @param {ReadDoc} readDoc
 * @param {number | null | undefined} season an omitted season uses the store's current season
 * @param {string[]} keys
 */
export async function readSeasonDocs(readDoc, season, keys) {
  const kept = await Promise.all([...keys, "live/current"].map((key) => readDoc(key)));
  const current = kept.at(-1)?.season;
  const requested = season ?? current;
  return {
    docs: kept.slice(0, -1),
    isCurrentSeason: requested === current,
    unavailable:
      current && requested < current && !kept[0]
        ? respondError(409, NOT_AVAILABLE_YET, NOT_AVAILABLE_TITLE)
        : null,
  };
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
