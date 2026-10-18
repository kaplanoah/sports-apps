// A device's own storage for a test, in place of the browser's localStorage.

/** @param {Partial<Storage>} storage */
const useStorage = (storage) =>
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

/** What storage does when it refuses access, as in a private window. */
const refuseAccess = () => {
  throw new Error("Access denied");
};

/** @param {Map<string, string>} saved */
const readSaved = (saved) => (/** @type {string} */ key) => saved.get(key) ?? null;

/**
 * Storage holding what's saved under each key.
 * @param {Map<string, string>} saved
 */
export const useSavedStorage = (saved) =>
  useStorage({
    getItem: readSaved(saved),
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  });

/**
 * Storage holding each choice a device kept, as the page keeps them.
 * @param {[string, unknown][]} kept each choice's key and value
 */
export const useKeptChoices = (kept) =>
  useSavedStorage(new Map(kept.map(([key, value]) => [key, JSON.stringify(value)])));

/**
 * Storage that's full: it reads what's saved but refuses to save more.
 * @param {Map<string, string>} saved
 */
export const useFullStorage = (saved) =>
  useStorage({ getItem: readSaved(saved), setItem: refuseAccess });

/** Storage that refuses every read and write, as in a private window. */
export const useDeniedStorage = () => useStorage({ getItem: refuseAccess, setItem: refuseAccess });

export const dropSavedStorage = () => {
  delete (/** @type {any} */ (globalThis).localStorage);
};
