/**
 * A device's own storage for a test, holding what's saved under each key.
 * @param {Map<string, string>} saved
 */
export const useSavedStorage = (saved) =>
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
    configurable: true,
  });

export const dropSavedStorage = () => {
  delete (/** @type {any} */ (globalThis).localStorage);
};
