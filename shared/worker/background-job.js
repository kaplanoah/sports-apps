import { isSameJson } from "../page/compare.js";

// What a league's background jobs share: one job serving every store with what each keeps in memory
// between runs, saving a document only when it changed, and the seasons a job fills from before the
// current one.

/** @typedef {import("./season-store.js").JobContext} JobContext */
/** @typedef {(context: JobContext) => Promise<void>} StoreUpdate */

/**
 * A job that makes each store it serves its own update, with what that update keeps between runs.
 * One job serves every store made from its module, as each test makes its own.
 * @param {number} delayMs the wait from one run's start to the next
 * @param {() => StoreUpdate} createStoreUpdate
 * @returns {import("./season-store.js").BackgroundJob}
 */
export function createPerStoreJob(delayMs, createStoreUpdate) {
  /** @type {WeakMap<JobContext["docs"], StoreUpdate>} */
  const updates = new WeakMap();
  return {
    chooseDelay: () => delayMs,
    updateStore(context) {
      if (!updates.has(context.docs)) updates.set(context.docs, createStoreUpdate());
      return /** @type {StoreUpdate} */ (updates.get(context.docs))(context);
    },
  };
}

/**
 * Each document as a job last read or saved it, so a run compares without reading the store again.
 */
export function createSavedDocs() {
  /** @type {Map<string, any>} */
  const saved = new Map();

  /**
   * @param {JobContext["docs"]} docs
   * @param {string} key
   */
  async function readDoc(docs, key) {
    if (!saved.has(key)) saved.set(key, await docs.read(key));
    return saved.get(key);
  }

  /**
   * Saves the document unless it's what the store already has, and says whether it saved it.
   * @param {JobContext["docs"]} docs
   * @param {string} key
   * @param {any} doc
   */
  async function saveDoc(docs, key, doc) {
    if (isSameJson(await readDoc(docs, key), doc)) return false;
    await docs.write(key, doc);
    saved.set(key, doc);
    return true;
  }

  return { readDoc, saveDoc };
}

/**
 * The seasons the store keeps from before the current one, newest first.
 * @param {JobContext["docs"]} docs
 * @param {number} current
 */
export async function listPastSeasons(docs, current) {
  const seasons = await docs.list("seasons");
  return seasons
    .map((/** @type {any} */ saved) => Number(saved?.year))
    .filter((year) => Number.isInteger(year) && year < current)
    .sort((first, second) => second - first);
}
