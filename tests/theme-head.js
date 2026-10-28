import { createContext, runInContext } from "node:vm";
import { readRepoFile } from "./repo-files.js";

/** @param {Record<string, string>} [entries] */
export function createStorage(entries = {}) {
  const items = new Map(Object.entries(entries));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

/** @param {{ href: string }} location */
export function createHistory(location) {
  return {
    state: null,
    replaceState: (state, unused, address) => {
      location.href = String(address);
    },
  };
}

/**
 * Runs both classic head scripts in their page order, before any page module can draw. The
 * stylesheet gives each theme the floor `floors` names, or none.
 * @param {{
 *   choice?: string,
 *   phoneLook?: "light" | "dark",
 *   href?: string,
 *   now?: number,
 *   floors?: Record<string, string>,
 * }} [page]
 */
export function loadThemeHead({
  choice,
  phoneLook = "light",
  href = "https://sports.example/",
  now = Date.now(),
  floors = {},
} = {}) {
  const localStorage = createStorage(
    choice === undefined ? {} : { appearance: JSON.stringify(choice) },
  );
  const location = { href };
  const theme = { dataset: /** @type {Record<string, string>} */ ({}) };
  const barColor = {
    content: "",
    setAttribute: (/** @type {string} */ name, /** @type {string} */ value) => {
      if (name === "content") barColor.content = value;
    },
  };
  const context = createContext({
    localStorage,
    location,
    history: createHistory(location),
    document: {
      documentElement: theme,
      querySelector: () => null,
      getElementById: (id) => (id === "themeColor" ? barColor : null),
    },
    getComputedStyle: () => ({
      getPropertyValue: (name) => (name === "--bg" ? (floors[theme.dataset.theme] ?? "") : ""),
    }),
    navigator: {},
    matchMedia: (query) => ({
      matches: query === "(prefers-color-scheme: dark)" && phoneLook === "dark",
    }),
    Date: { now: () => now },
    URL,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
  });
  for (const name of ["page-move", "pick-theme"])
    runInContext(readRepoFile(`shared/page/${name}.js`), context);
  return {
    ...runInContext("({ resolveTheme, showTheme, readPageMove, packCarried })", context),
    theme,
    barColor,
    setPhoneLook: (/** @type {"light" | "dark"} */ look) => {
      phoneLook = look;
    },
  };
}
