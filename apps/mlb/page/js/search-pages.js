// What MLB's search finds besides games, as it hands the shared pages (page-places.js): its clubs,
// the next game's Matchup, its Bracket, the standings' playoff fields and each league's divisions,
// and the settings its page shows. Runs in the page and in Node, so it uses no DOM.

import {
  ATHLETIC_SETTING,
  DIAGNOSTICS_SETTING,
  CONTACT_SETTING,
  NEWS_TAB,
  NOTIFICATIONS_SETTING,
  SEASON_SETTING,
  SETTINGS_ROW,
  composeSearchPages,
  describeAppearanceSetting,
  describeTeamOutletsSetting,
} from "#shared/page-places.js";
import { nameClubFully } from "./clubs.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/page-search.js").PagePlace} PagePlace */

/** @type {PagePlace[]} */
const TABS = [
  {
    key: "season:bracket",
    name: ["Bracket"],
    words: ["bracket", "playoffs", "postseason"],
    icon: "bracket",
  },
  NEWS_TAB,
];

const LEAGUE_NAMES = { AL: "American League", NL: "National League" };
/** The standings' part their playoff fields lead, which opens them at their top. */
export const PLAYOFF_FIELDS = "playoffs";
const DIVISIONS = ["East", "Central", "West"];

/**
 * A part of the standings, by its key and name, and the words that find it.
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
  describeStandingsPart(PLAYOFF_FIELDS, "Playoffs", [
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

/** @type {import("#shared/page-places.js").LeaguePages} */
const LEAGUE_PAGES = {
  teams: Object.entries(TEAMS).map(([code, { name }]) => ({
    code,
    name,
    fullName: nameClubFully(code),
  })),
  places: [...TABS, ...STANDINGS],
  settings: [
    SETTINGS_ROW,
    SEASON_SETTING,
    NOTIFICATIONS_SETTING,
    describeAppearanceSetting(["ball", "night game"]),
    describeTeamOutletsSetting("Mets", ["beat writers"]),
    ATHLETIC_SETTING,
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
    CONTACT_SETTING,
    DIAGNOSTICS_SETTING,
  ],
  gameParts: [
    {
      key: "matchup",
      name: "Matchup",
      words: ["matchup", "probables", "probable pitchers", "pitching matchup"],
      game: "next",
    },
  ],
  examples: ["Yamamoto", "Mets roster"],
  isOutKnown: false,
};

/**
 * The clubs, players, and places a search can open, each club with its record from the
 * standings, and the stories the News tab shows.
 * @param {{ index: { players: import("#shared/page-search.js").PagePlayer[] } | null, isSettingShown: (key: string) => boolean, divisions?: Record<string, { id: string, w: number, l: number }[]>, stories?: import("#shared/news-picks.js").NewsStory[] }} shown
 */
export const listSearchPages = ({ divisions = {}, ...shown }) =>
  composeSearchPages(LEAGUE_PAGES, {
    ...shown,
    standings: Object.values(divisions)
      .flat()
      .map((row) => ({ team: row.id, wins: row.w, losses: row.l })),
  });
