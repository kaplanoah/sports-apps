// What the page keeps on this device. Storage can be empty, refuse access, as in a private window,
// or be full, so the page never depends on it: a read that fails finds nothing, and a write or a
// removal that fails says so and changes nothing.

/**
 * @param {string} key
 * @returns {string | null}
 */
export function readStoredText(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * What's kept under `key` as JSON, or null when nothing is or it isn't JSON.
 * @param {string} key
 * @returns {any}
 */
export function readStoredJson(key) {
  try {
    return JSON.parse(readStoredText(key) ?? "null");
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} text
 * @returns {boolean} whether it was kept
 */
export function storeText(key, text) {
  try {
    localStorage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} whether it was kept
 */
export const storeJson = (key, value) => storeText(key, JSON.stringify(value));

/**
 * @param {string} key
 * @returns {boolean} whether it's gone
 */
export function forgetStored(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
