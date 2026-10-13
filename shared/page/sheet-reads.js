// What sheets read from the app's Worker, each kept by what it's about, like a player's id and
// season: what the last read found, whether a read is under way, and why the last one failed. A
// sheet reads again once what it keeps is old, sooner when it found nothing, and a read that fails
// or finds nothing of something keeps what the read before found of it. Runs in the page and in
// Node, so it uses no DOM.

import { classifyReadFailure } from "./retry.js";

/** @typedef {import("./retry.js").ReadFailure} ReadFailure */
/**
 * A read as a sheet shows it: what it found, when it started, whether it's under way, and why it
 * failed.
 * @template {object} Found
 * @typedef {Found & { at: number, isLoading: boolean, failure: ReadFailure | null }} SheetRead
 */
/**
 * What one read answers: what it found, field by field, and why it failed, if it did.
 * @template {object} Found
 * @typedef {{ found: Partial<Found>, failure?: ReadFailure | null }} ReadAnswer
 */

// What a sheet shows changes with each game, so it's read again ten minutes after it was found.
export const SHEET_READ_AGAIN_MS = 10 * 60 * 1000;
// A read that found nothing is tried again a minute later.
const RETRY_MS = 60 * 1000;
export const SHEET_FETCH_TIMEOUT_MS = 15 * 1000;

/**
 * Whether a read is recent enough to show without reading again: one under way, or one that found
 * something less than ten minutes ago, or nothing less than a minute ago.
 * @param {{ at: number, isLoading: boolean }} read
 * @param {boolean} hasFound
 * @param {number} now
 */
export const isReadFresh = (read, hasFound, now) =>
  read.isLoading || now - read.at < (hasFound ? SHEET_READ_AGAIN_MS : RETRY_MS);

/**
 * What a read keeps once it answers: each field it found, and for each it found nothing of, as
 * where it failed, what the read before found.
 * @template {object} Found
 * @param {SheetRead<Found>} read
 * @param {ReadAnswer<Found>} answer
 * @returns {SheetRead<Found>}
 */
export function keepAnswer(read, { found, failure = null }) {
  const kept = Object.entries(found).filter(([, value]) => value !== null && value !== undefined);
  return { ...read, ...Object.fromEntries(kept), isLoading: false, failure };
}

/**
 * The reads a sheet keeps. `hasFound` says whether a read found what the sheet shows, so a read
 * that didn't is tried again sooner and dropped for Try again, and `show` draws again as a read
 * answers.
 * @template {object} Found
 * @param {{ empty: Found, hasFound: (read: Found) => boolean, show: (key: string) => void }} options
 */
export function createSheetReads({ empty, hasFound, show }) {
  /** @type {Map<string, SheetRead<Found>>} */
  const reads = new Map();

  /**
   * @param {string} key
   * @param {SheetRead<Found>} read
   * @param {ReadAnswer<Found>} answer
   */
  function keepIfCurrent(key, read, answer) {
    if (reads.get(key) !== read) return;
    reads.set(key, keepAnswer(read, answer));
    show(key);
  }

  return {
    /**
     * The last read of `key`, after starting a new one with `load` when there's none or it's old.
     * A read that rejects fails, keeping what the read before found.
     * @param {string} key
     * @param {(kept: SheetRead<Found>) => Promise<ReadAnswer<Found>>} load
     * @returns {SheetRead<Found>}
     */
    read(key, load) {
      const kept = reads.get(key);
      if (kept && isReadFresh(kept, hasFound(kept), Date.now())) return kept;
      /** @type {SheetRead<Found>} */
      const read = { ...empty, ...kept, at: Date.now(), isLoading: true, failure: null };
      reads.set(key, read);
      load(read).then(
        (answer) => keepIfCurrent(key, read, answer),
        (error) => keepIfCurrent(key, read, { found: {}, failure: classifyReadFailure(error) }),
      );
      return read;
    },
    /**
     * The last read of `key`, or null before one starts.
     * @param {string} key
     */
    find: (key) => reads.get(key) ?? null,
    /**
     * Takes back what a sheet showed of `key` before a reload, to show while it reads again,
     * unless it has read it since.
     * @param {string} key
     * @param {Partial<Found>} found
     */
    keepShown(key, found) {
      if (!reads.has(key))
        reads.set(key, { ...empty, ...found, at: 0, isLoading: false, failure: null });
    },
    /**
     * Drops a read of `key` that found nothing and isn't under way, so the sheet shows its
     * placeholders while it reads again; whether it did.
     * @param {string} key
     */
    drop(key) {
      const read = reads.get(key);
      if (!read || hasFound(read) || read.isLoading) return false;
      return reads.delete(key);
    },
  };
}
