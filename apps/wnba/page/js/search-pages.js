// What the WNBA's search finds besides games: each team's sheet, with its record, and its Roster,
// each player on a team's roster in the season shown, and who is out, from the list of players the
// store keeps for the season, a final's Highlights, the Bracket and News tabs, with each team's
// newest stories, the Standings tab's lists, and settings and each setting the page shows. Runs in
// the page and in Node, so it uses no DOM.

import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/page-search.js").SearchPages} SearchPages */
/** @typedef {import("#shared/page-search.js").PagePlace} PagePlace */
/** @typedef {import("#shared/news-picks.js").NewsStory} NewsStory */
/**
 * A player as the store's list of a season's players has her, with why she's out while she is.
 * @typedef {{ id: string, team: string, number: string, firstName: string, lastName: string, out?: import("#shared/page-search.js").PlayerOut | null }} IndexedPlayer
 */

/**
 * Where the store keeps a season's list of players.
 * @param {number} season
 */
export const namePlayerIndexKey = (season) => `player-index/${season}`;

/**
 * Where the store keeps which of a season's finals went to overtime, for search.
 * @param {number} season
 */
export const nameOvertimesKey = (season) => `overtimes/${season}`;

const SECTION = { key: "roster", name: "Roster" };
const GAME_PART = {
  key: "highlights",
  name: "Highlights",
  words: ["highlights", "recap", "clips", "video"],
};
const EXAMPLES = ["Stewart", "Aces roster"];

// The words that ask how the playoffs stand, which both the Bracket and the league's standings
// answer.
const PLAYOFF_PICTURE = ["playoff picture", "seeds", "seeding", "clinched", "clinch"];

const NEWS_TAB = {
  key: "tab:news",
  name: ["News"],
  words: ["news", "stories", "headlines"],
  icon: /** @type {const} */ ("news"),
};

/** @type {PagePlace[]} */
const TABS = [
  {
    key: "tab:bracket",
    name: ["Bracket"],
    words: ["bracket", "playoffs", ...PLAYOFF_PICTURE],
    icon: "bracket",
  },
  NEWS_TAB,
];

/** @type {PagePlace[]} */
const STANDINGS = [
  {
    key: "standings:league",
    name: ["Standings", "League"],
    words: ["standings", "table", "league standings", ...PLAYOFF_PICTURE],
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
 * The teams, players, and places a search of a season can open, each team with its record from the
 * standings, and the stories the News tab shows.
 * @param {{ index: { players: IndexedPlayer[] } | null, isSettingShown: (key: string) => boolean, standings?: { team: string, wins: number, losses: number }[], stories?: NewsStory[] }} shown
 * @returns {SearchPages}
 */
export function listSearchPages({ index, isSettingShown, standings = [], stories = [] }) {
  const records = new Map(standings.map((row) => [row.team, `${row.wins}-${row.losses}`]));
  return {
    teams: Object.entries(TEAMS).map(([code, { city, name }]) => ({
      code,
      name,
      fullName: `${city} ${name}`,
      ...(records.has(code) && { record: records.get(code) }),
    })),
    players: (index?.players ?? []).map(({ id, team, firstName, lastName, number, out }) => ({
      id,
      team,
      firstName,
      lastName,
      number,
      out: out ?? null,
    })),
    section: SECTION,
    places: [...TABS, ...STANDINGS, ...listSettings(isSettingShown)],
    gamePart: GAME_PART,
    examples: EXAMPLES,
    news: { place: NEWS_TAB, stories: listNewestFirst(stories) },
  };
}

/**
 * Stories, newest first.
 * @param {NewsStory[]} stories
 */
const listNewestFirst = (stories) =>
  [...stories].sort(
    (first, second) => Date.parse(second.publishedAt) - Date.parse(first.publishedAt),
  );
