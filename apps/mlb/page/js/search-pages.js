// What MLB's search finds besides games: each club's sheet and its Roster, each player on a club's
// roster this season, from the list of players the store keeps for it, a final's Highlights and the
// next game's Matchup, the Bracket and News tabs, the Standings tab's playoff fields and each
// league's divisions, and settings and each setting the page shows. Runs in the page and in Node, so
// it uses no DOM.

import { nameClubFully } from "./clubs.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/page-search.js").SearchPages} SearchPages */
/** @typedef {import("#shared/page-search.js").PagePlace} PagePlace */
/** @typedef {import("#shared/page-search.js").PagePlayer} PagePlayer */
/** @typedef {import("#shared/page-search.js").GamePart} GamePart */

const SECTION = { key: "roster", name: "Roster" };
/** @type {GamePart[]} */
const GAME_PARTS = [
  {
    key: "highlights",
    name: "Highlights",
    words: ["highlights", "recap", "clips", "video"],
    game: "latest-final",
  },
  {
    key: "matchup",
    name: "Matchup",
    words: ["matchup", "probables", "probable pitchers", "pitching matchup"],
    game: "next",
  },
];
const EXAMPLES = ["Yamamoto", "Mets roster"];

/** @type {PagePlace[]} */
const TABS = [
  {
    key: "tab:bracket",
    name: ["Bracket"],
    words: ["bracket", "playoffs", "postseason"],
    icon: "bracket",
  },
  { key: "tab:news", name: ["News"], words: ["news", "stories", "headlines"], icon: "news" },
];

const LEAGUE_NAMES = { AL: "American League", NL: "National League" };
const DIVISIONS = ["East", "Central", "West"];

/**
 * A part of the Standings tab, by its key and name, and the words that find it.
 * @param {string} part
 * @param {string} name
 * @param {string[]} words
 * @returns {PagePlace}
 */
const describeStandingsPart = (part, name, words) => ({
  key: `standings:${part}`,
  name: ["Standings", name],
  words: ["standings", "table", ...words],
  icon: "standings",
});

/** @type {PagePlace[]} */
const STANDINGS = [
  describeStandingsPart("playoffs", "Playoffs", [
    "playoffs",
    "postseason",
    "playoff field",
    "playoff race",
    "wild card",
  ]),
  ...Object.entries(LEAGUE_NAMES).map(([league, name]) =>
    describeStandingsPart(league, league, [
      league,
      name,
      "divisions",
      ...DIVISIONS.map((division) => `${league} ${division}`),
    ]),
  ),
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
    key: "settings:appearance",
    name: ["Appearance"],
    words: ["appearance", "theme", "dark mode", "light mode", "ball", "night game"],
  },
  {
    key: "settings:team-outlets",
    name: ["Include dedicated Mets sources"],
    words: ["dedicated sources", "beat writers", "news sources", "outlets"],
  },
  {
    key: "settings:paywalled",
    name: ["Include content from The Athletic"],
    words: ["the athletic", "paywall", "news sources", "outlets"],
  },
  {
    key: "settings:prospectus",
    name: ["Include content from Baseball Prospectus"],
    words: ["baseball prospectus", "paywall", "news sources", "outlets"],
  },
  {
    key: "settings:ranking",
    name: ["Ranking"],
    words: ["ranking", "rank", "favorite teams", "rooting"],
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
 * The clubs, players, and places a search can open.
 * @param {{ index: { players: PagePlayer[] } | null, isSettingShown: (key: string) => boolean }} shown
 * @returns {SearchPages}
 */
export function listSearchPages({ index, isSettingShown }) {
  return {
    teams: Object.entries(TEAMS).map(([code, { name }]) => ({
      code,
      name,
      fullName: nameClubFully(code),
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
