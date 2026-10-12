const LAST_TAB_KEY = "lastTab";
const TAB_BEFORE_KEY = "tabBeforeLast";

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.

/**
 * Keeps the tab the page shows, and the one it showed before, for a tab that a reload leaves for
 * the one before it, like a search after two minutes away (open-last-tab.js).
 * @param {string} tab
 * @param {string | undefined} before
 */
export function saveLastTab(tab, before) {
  try {
    localStorage.setItem(LAST_TAB_KEY, tab);
    if (before && before !== tab) localStorage.setItem(TAB_BEFORE_KEY, before);
  } catch {
    /* the page opens on its first tab instead */
  }
}

/** The tab shown before the last one, or null. */
export function readTabBeforeLast() {
  try {
    return localStorage.getItem(TAB_BEFORE_KEY);
  } catch {
    return null;
  }
}
