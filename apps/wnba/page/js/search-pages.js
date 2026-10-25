// What the WNBA's search finds besides games, as it hands the shared pages (page-places.js): its
// teams, its Bracket and the standings' lists, and the settings its page shows. Runs in the page
// and in Node, so it uses no DOM.

import {
  ATHLETIC_SETTING,
  DIAGNOSTICS_SETTING,
  NEWS_TAB,
  NOTIFICATIONS_SETTING,
  REMINDERS_SETTING,
  SEASON_SETTING,
  SETTINGS_ROW,
  composeSearchPages,
  describeAppearanceSetting,
  describeTeamOutletsSetting,
} from "#shared/page-places.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/page-search.js").PagePlace} PagePlace */

/**
 * Where the store keeps which of a season's finals went to overtime, for search.
 * @param {number} season
 */
export const nameOvertimesKey = (season) => `overtimes/${season}`;

// The words that ask how the playoffs stand, which both the Bracket and the league's standings
// answer.
const PLAYOFF_PICTURE = ["playoff picture", "seeds", "seeding", "clinched", "clinch"];

/** @type {PagePlace[]} */
const TABS = [
  {
    key: "season:bracket",
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

/** @type {import("#shared/page-places.js").LeaguePages} */
const LEAGUE_PAGES = {
  teams: Object.entries(TEAMS).map(([code, { city, name }]) => ({
    code,
    name,
    fullName: `${city} ${name}`,
  })),
  places: [...TABS, ...STANDINGS],
  settings: [
    SETTINGS_ROW,
    SEASON_SETTING,
    NOTIFICATIONS_SETTING,
    REMINDERS_SETTING,
    describeTeamOutletsSetting("Liberty"),
    ATHLETIC_SETTING,
    describeAppearanceSetting(["walnut", "maple"]),
    DIAGNOSTICS_SETTING,
  ],
  gameParts: [],
  examples: ["Stewart", "Aces roster"],
  isOutKnown: true,
};

/**
 * The teams, players, and places a search of a season can open, each team with its record from the
 * standings, and the stories the News tab shows.
 * @param {{ index: { players: import("#shared/page-search.js").PagePlayer[] } | null, isSettingShown: (key: string) => boolean, standings?: { team: string, wins: number, losses: number }[], stories?: import("#shared/news-picks.js").NewsStory[] }} shown
 */
export const listSearchPages = (shown) => composeSearchPages(LEAGUE_PAGES, shown);
