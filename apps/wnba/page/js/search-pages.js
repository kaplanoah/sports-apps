// What the WNBA's search finds besides games: each team's sheet and its Roster, each player on a
// team's roster in the season shown, from the list of players the store keeps for the season, a
// final's Highlights, the Bracket and News tabs, the Standings tab's lists, and settings and each
// setting the page shows. Runs in the page and in Node, so it uses no DOM.

import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/page-search.js").SearchPages} SearchPages */
/** @typedef {import("#shared/page-search.js").PagePlace} PagePlace */
/** @typedef {import("#shared/page-search.js").PagePlayer} PagePlayer */

const SECTION = { key: "roster", name: "Roster" };
/** @type {import("#shared/page-search.js").GamePart[]} */
const GAME_PARTS = [
  {
    key: "highlights",
    name: "Highlights",
    words: ["highlights", "recap", "clips", "video"],
    game: "latest-final",
  },
];
const EXAMPLES = ["Stewart", "Aces roster"];

/** @type {PagePlace[]} */
const TABS = [
  { key: "tab:bracket", name: ["Bracket"], words: ["bracket", "playoffs"], icon: "bracket" },
  { key: "tab:news", name: ["News"], words: ["news", "stories", "headlines"], icon: "news" },
];

/** @type {PagePlace[]} */
const STANDINGS = [
  {
    key: "standings:league",
    name: ["Standings", "League"],
    words: ["standings", "table", "league standings"],
    icon: "standings",
  },
  {
    key: "standings:east",
    name: ["Standings", "East"],
    words: ["standings", "table", "east", "eastern conference"],
    icon: "standings",
  },
  {
    key: "standings:west",
    name: ["Standings", "West"],
    words: ["standings", "table", "west", "western conference"],
    icon: "standings",
  },
];

// Each setting by the key the page names its row with, the words of its row, and the words that
// find it beside them.
const SETTINGS = [
  { key: "settings", name: [], words: ["settings", "preferences"] },
  { key: "settings:season", name: ["Season"], words: ["season", "year", "past seasons"] },
  {
    key: "settings:notifications",
    name: ["Notifications"],
    words: ["notifications", "notify", "alerts", "push"],
  },
  {
    key: "settings:team-outlets",
    name: ["Include dedicated Liberty sources"],
    words: ["dedicated sources", "news sources", "outlets"],
  },
  {
    key: "settings:paywalled",
    name: ["Include content from The Athletic"],
    words: ["the athletic", "paywall", "news sources", "outlets"],
  },
  {
    key: "settings:appearance",
    name: ["Appearance"],
    words: ["appearance", "theme", "dark mode", "light mode", "walnut", "maple"],
  },
  { key: "settings:diagnostics", name: ["Diagnostics"], words: ["diagnostics", "report"] },
];

/**
 * The settings a search can open: those the page shows, as `isShown` says by key.
 * @param {(key: string) => boolean} isShown
 * @returns {PagePlace[]}
 */
const listSettings = (isShown) =>
  SETTINGS.filter(({ key }) => isShown(key)).map(({ key, name, words }) => ({
    key,
    name: ["Settings", ...name],
    words: key === "settings" ? words : ["settings", ...words],
    icon: "settings",
  }));

/**
 * The teams, players, and places a search of a season can open.
 * @param {{ index: { players: PagePlayer[] } | null, isSettingShown: (key: string) => boolean }} shown
 * @returns {SearchPages}
 */
export function listSearchPages({ index, isSettingShown }) {
  return {
    teams: Object.entries(TEAMS).map(([code, { city, name }]) => ({
      code,
      name,
      fullName: `${city} ${name}`,
    })),
    players: (index?.players ?? []).map(({ id, team, firstName, lastName, number }) => ({
      id,
      team,
      firstName,
      lastName,
      number,
    })),
    section: SECTION,
    places: [...TABS, ...STANDINGS, ...listSettings(isSettingShown)],
    gameParts: GAME_PARTS,
    examples: EXAMPLES,
  };
}
