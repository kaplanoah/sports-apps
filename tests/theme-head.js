import { createContext, runInContext } from "node:vm";
import { readRepoFile } from "./repo-files.js";

/**
 * Runs both classic head scripts in their page order, before any page module can draw.
 * @param {{ choice?: string, phoneLook?: "light" | "dark", href?: string, now?: number }} [page]
 */
export function loadThemeHead({
  choice,
  phoneLook = "light",
  href = "https://sports.example/",
  now = Date.now(),
} = {}) {
  const stored = new Map(choice === undefined ? [] : [["appearance", JSON.stringify(choice)]]);
  const localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  };
  const location = { href };
  const theme = { dataset: /** @type {Record<string, string>} */ ({}) };
  const context = createContext({
    localStorage,
    location,
    history: {
      state: null,
      replaceState: (state, unused, address) => {
        location.href = String(address);
      },
    },
    document: { documentElement: theme, querySelector: () => null },
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
    ...runInContext(
      "({ isLook, readAppearanceChoice, resolveTheme, showTheme, readPageMove, packCarried })",
      context,
    ),
    theme,
    setPhoneLook: (/** @type {"light" | "dark"} */ look) => {
      phoneLook = look;
    },
  };
}
