// Stand-ins for what the store hands a league's job (`JobContext` in shared/worker/season-store.js):
// its documents and its own storage. Each copies what goes in and comes out, as the store does.

/**
 * A job's own storage, starting with `initial`.
 * @param {Record<string, any>} [initial]
 */
export function createJobStorage(initial = {}) {
  const stored = new Map(Object.entries(initial));
  return {
    stored,
    get: async (/** @type {string} */ key) => structuredClone(stored.get(key)),
    put: async (/** @type {string} */ key, /** @type {any} */ value) => {
      stored.set(key, structuredClone(value));
    },
    delete: async (/** @type {string} */ key) => stored.delete(key),
    list: async (/** @type {string} */ prefix) =>
      new Map([...stored].filter(([key]) => key.startsWith(prefix))),
  };
}

/**
 * The store's documents, starting with `initial`, keeping the key of each write and removal and the
 * collection of each list in order.
 * @param {Record<string, any>} [initial]
 */
export function createDocs(initial = {}) {
  const stored = new Map(Object.entries(initial));
  /** @type {string[]} */
  const writes = [];
  /** @type {string[]} */
  const removals = [];
  /** @type {string[]} */
  const lists = [];
  return {
    stored,
    writes,
    removals,
    lists,
    read: async (/** @type {string} */ key) => structuredClone(stored.get(key)) ?? null,
    list: async (/** @type {string} */ collection) => {
      lists.push(collection);
      return [...stored]
        .filter(([key]) => key.startsWith(`${collection}/`))
        .map(([, doc]) => structuredClone(doc));
    },
    write: async (/** @type {string} */ key, /** @type {any} */ doc) => {
      writes.push(key);
      stored.set(key, structuredClone(doc));
    },
    remove: async (/** @type {string} */ key) => {
      removals.push(key);
      stored.delete(key);
    },
  };
}
