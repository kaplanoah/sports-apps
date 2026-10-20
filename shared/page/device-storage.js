// What a viewer chooses on a page, like a ranking, a dismissal, or a theme, kept on their own
// device as JSON under its key. Nobody signs in, and people share a page's address, so the page
// saves nothing of a viewer's to the store. Every choice is listed, so carrying a viewer's choices
// between their devices can find them all, and each tells the page when something other than the
// page itself, like another tab, changes it. Storage can refuse access, as in a private window, or
// be full, and then a choice lasts until the page reloads.

import { readStoredText, storeJson } from "./local-storage.js";

/**
 * @template T
 * @typedef {object} ViewerChoice
 * @property {() => T} read the choice as the device keeps it, or its default
 * @property {(value: T) => void} keep
 * @property {(onChange: () => void) => () => void} watch calls `onChange` whenever another tab
 *   changes the choice, and returns a way to stop
 */

/** @type {Set<string>} */
const viewerChoiceKeys = new Set();
/** @type {Map<string, unknown>} */
const keptInMemory = new Map();
/** @type {Map<string, Set<() => void>>} */
const watchersByKey = new Map();
let isWatchingOtherTabs = false;

// A value a device kept as plain text, like a theme's name, reads as that text.
/** @param {string} text */
function parseKept(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// A choice storage refused to keep, as when it's full, lives in memory, ahead of the older value
// storage still holds.
/** @param {string} key */
function readKept(key) {
  if (keptInMemory.has(key)) return keptInMemory.get(key);
  const text = readStoredText(key);
  return text === null ? null : parseKept(text);
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function keep(key, value) {
  if (storeJson(key, value)) keptInMemory.delete(key);
  else keptInMemory.set(key, value);
}

/** @param {string | null} key */
function tellWatchers(key) {
  const keys = key === null ? [...watchersByKey.keys()] : [key];
  for (const each of keys) for (const onChange of watchersByKey.get(each) ?? []) onChange();
}

/** @param {string | null} key */
function forgetKeptInMemory(key) {
  if (key === null) keptInMemory.clear();
  else keptInMemory.delete(key);
}

// Another tab's change to storage comes as an event, with no key when it cleared it all. What it
// saved is newer than a choice this tab could only keep in memory.
function watchOtherTabs() {
  if (isWatchingOtherTabs || typeof addEventListener !== "function") return;
  isWatchingOtherTabs = true;
  addEventListener("storage", (event) => {
    forgetKeptInMemory(event.key);
    tellWatchers(event.key);
  });
}

/**
 * @param {string} key
 * @param {() => void} onChange
 */
function watchKey(key, onChange) {
  watchOtherTabs();
  if (!watchersByKey.has(key)) watchersByKey.set(key, new Set());
  const watchers = /** @type {Set<() => void>} */ (watchersByKey.get(key));
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

/**
 * A choice the viewer makes, kept on this device under `key`.
 * @template T
 * @param {string} key
 * @param {(stored: unknown) => T} readValue the choice from what's stored, null when nothing is,
 *   with its default for anything it doesn't recognize
 * @returns {ViewerChoice<T>}
 */
export function createViewerChoice(key, readValue) {
  viewerChoiceKeys.add(key);
  return {
    read: () => readValue(readKept(key)),
    keep: (value) => keep(key, value),
    watch: (onChange) => watchKey(key, onChange),
  };
}

/** The keys of every choice the page has made. */
export const listViewerChoices = () => [...viewerChoiceKeys];
