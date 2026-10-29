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
   * @param {Pick<JobContext["docs"], "read">} docs
   * @param {string} key
   */
  async function readDoc(docs, key) {
    if (!saved.has(key)) saved.set(key, await docs.read(key));
    return saved.get(key);
  }

  /**
   * Saves the document unless it's what the store already has, and says whether it saved it.
   * @param {Pick<JobContext["docs"], "read" | "write">} docs
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
 * Where a job keeps a version of what it keeps under `key`, the first version under `key` itself,
 * since each record's first version was saved under the bare key, before records had versions.
 * @param {string} key
 * @param {number} version
 */
export const nameVersionedKey = (key, version) => (version === 1 ? key : `${key}:v${version}`);

/**
 * Forgets what a job kept under a key's earlier versions, each once while the store stays in
 * memory, so raising a version leaves nothing behind in the job's storage.
 */
export function createVersionForgetter() {
  /** @type {Set<string>} */
  const forgotten = new Set();

  /**
   * @param {JobContext["storage"]} storage
   * @param {(version: number) => string} nameKey the key a version is kept under
   * @param {number} version the current one, which stays
   */
  return async function forgetEarlierVersions(storage, nameKey, version) {
    for (let earlier = 1; earlier < version; earlier += 1) {
      const key = nameKey(earlier);
      if (forgotten.has(key)) continue;
      forgotten.add(key);
      await storage.delete(key);
    }
  };
}

/**
 * The seasons the store keeps from before the current one, newest first.
 * @param {Pick<JobContext["docs"], "list">} docs
 * @param {number} current
 */
export async function listPastSeasons(docs, current) {
  const seasons = await docs.list("seasons");
  return seasons
    .map((/** @type {any} */ saved) => Number(saved?.year))
    .filter((year) => Number.isInteger(year) && year < current)
    .sort((first, second) => second - first);
}
