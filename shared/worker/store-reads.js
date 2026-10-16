import { describeError } from "./responses.js";

// What the Worker's routes read from the store, so a tap reads the league only for what the store
// doesn't keep, and count each read of the league the store should have spared.

/**
 * Reads a document from the store, as null when it has none.
 * @typedef {(key: string) => Promise<any>} ReadDoc
 */

/**
 * The document the store keeps at `key`, or null when it keeps none, the Worker has no store, or
 * the store can't be read, for the route to read the league instead.
 * @param {ReadDoc | undefined} readDoc
 * @param {string} key
 */
export async function readKeptDoc(readDoc, key) {
  if (!readDoc) return null;
  try {
    return await readDoc(key);
  } catch (error) {
    console.error(`Reading ${key} from the store failed: ${describeError(error)}`);
    return null;
  }
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
