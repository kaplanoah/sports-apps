// A device's own storage for a test, in place of the browser's localStorage.

/** @param {Partial<Storage>} storage */
export const useStorage = (storage) =>
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

/**
 * Storage holding what's saved under each key.
 * @param {Map<string, string>} saved
 */
export const useSavedStorage = (saved) =>
  useStorage({
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  });

export const dropSavedStorage = () => {
  delete (/** @type {any} */ (globalThis).localStorage);
};

/** What storage does when it refuses access, as in a private window. */
export const refuseAccess = () => {
  throw new Error("Access denied");
};
