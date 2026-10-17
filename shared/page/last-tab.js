import { readStoredText, storeText } from "./local-storage.js";

const LAST_TAB_KEY = "lastTab";
const TAB_BEFORE_KEY = "tabBeforeLast";

// Storage that refuses the tab has the page open on its first tab instead.

/**
 * Keeps the tab the page shows, and the one it showed before, for a tab that a reload leaves for
 * the one before it, like a search after two minutes away (open-last-tab.js).
 * @param {string} tab
 * @param {string | undefined} before
 */
export function saveLastTab(tab, before) {
  storeText(LAST_TAB_KEY, tab);
  if (before && before !== tab) storeText(TAB_BEFORE_KEY, before);
}

/** The tab shown before the last one, or null. */
export const readTabBeforeLast = () => readStoredText(TAB_BEFORE_KEY);
