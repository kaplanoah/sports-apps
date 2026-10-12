// What MLB's search finds besides games: each club's sheet and its Roster, each player on a club's
// roster this season, from the list of players the store keeps for it, a final's Highlights and the
// next game's Matchup, the Bracket and News tabs, each league's playoff field and each division on
// the Standings tab, and settings and each setting the page shows. Runs in the page and in Node, so
// it uses no DOM.

import { nameClubFully } from "./search-terms.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/page-search.js").SearchPages} SearchPages */
/** @typedef {import("#shared/page-search.js").PagePlace} PagePlace */
/** @typedef {import("#shared/page-search.js").GamePart} GamePart */
/**
 * A player as the store's list of the season's players has him.
 * @typedef {{ id: string, team: string, number: string, firstName: string, lastName: string }} IndexedPlayer
 */

/**
 * Where the store keeps a season's list of players.
 * @param {number} season
 */
export const namePlayerIndexKey = (season) => `player-index/${season}`;

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
const EXAMPLES = ["Lindor", "Dodgers roster"];

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
const DIVISION_NAMES = ["East", "Central", "West"];

/**
 * A block of the Standings tab, by its league or division, its title, and the words that find it.
 * @param {string} block
 * @param {string} title
 * @param {string[]} words
 * @returns {PagePlace}
 */
const describeStandingsBlock = (block, title, words) => ({
  key: `standings:${block}`,
  name: ["Standings", title],
  words: ["standings", "table", ...words],
  icon: "standings",
});

/** @type {PagePlace[]} */
const STANDINGS = [
  ...Object.entries(LEAGUE_NAMES).map(([league, name]) =>
    describeStandingsBlock(league, `${league} Playoff Field`, [
      league,
      name,
      "playoff field",
      "playoff race",
      "wild card",
    ]),
  ),
  ...Object.entries(LEAGUE_NAMES).flatMap(([league, name]) =>
    DIVISION_NAMES.map((division) =>
      describeStandingsBlock(`${league} ${division}`, `${league} ${division}`, [
        `${league} ${division}`,
        `${name} ${division}`,
        "division",
      ]),
    ),
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
 * @param {{ index: { players: IndexedPlayer[] } | null, isSettingShown: (key: string) => boolean }} shown
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
