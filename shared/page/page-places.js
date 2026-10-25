// What a league's search finds besides games, from what its search-pages.js hands in: each team's
// sheet, with its record, and its Roster, each player on a roster from the list of players the store
// keeps for the season, with why he or she is out where the list says, the league's own places,
// like its Bracket and standings, the News tab with the newest stories it shows, a game's parts,
// like a final's Highlights, and settings and each setting the page shows. Runs in the page and in
// Node, so it uses no DOM.

import { pickReadCards } from "./news-picks.js";

/** @typedef {import("./page-search.js").SearchPages} SearchPages */
/** @typedef {import("./page-search.js").PagePlace} PagePlace */
/** @typedef {import("./page-search.js").PagePlayer} PagePlayer */
/** @typedef {import("./page-search.js").GamePart} GamePart */
/** @typedef {import("./news-picks.js").NewsStory} NewsStory */
/**
 * A setting by the key the page names its row with, the words of its row, and the words that find
 * it beside them.
 * @typedef {{ key: string, name: string[], words: string[] }} SettingRow
 */
/**
 * What a league's search finds besides games, which differs by league.
 * @typedef {object} LeaguePages
 * @property {{ code: string, name: string, fullName: string }[]} teams
 * @property {PagePlace[]} places its tabs and its standings' parts
 * @property {SettingRow[]} settings in the order the settings sheet shows them
 * @property {GamePart[]} gameParts the parts of a game's sheet beside a final's Highlights
 * @property {string[]} examples
 * @property {boolean} isOutKnown whether its list of players says who is out
 */

const ROSTER_SECTION = { key: "roster", name: "Roster" };

/** @type {GamePart} */
const HIGHLIGHTS_PART = {
  key: "highlights",
  name: "Highlights",
  words: ["highlights", "recap", "clips", "video"],
  game: "latest-final",
};

/** @type {PagePlace} */
export const NEWS_TAB = {
  key: "tab:news",
  name: ["News"],
  words: ["news", "stories", "headlines"],
  icon: "news",
};

/** @type {SettingRow} */
export const SETTINGS_ROW = { key: "settings", name: [], words: ["settings", "preferences"] };
/** @type {SettingRow} */
export const SEASON_SETTING = {
  key: "settings:season",
  name: ["Season"],
  words: ["season", "year", "past seasons"],
};
/** @type {SettingRow} */
const NOTIFICATIONS_SETTING = {
  key: "settings:notifications",
  name: ["Notifications"],
  words: ["notifications", "notify", "alerts", "push", "game notifications"],
};
/** @param {Pick<import("./league-words.js").LeagueWords, "notificationUpdates">} words */
export const describeNotificationsSetting = (words) => ({
  ...NOTIFICATIONS_SETTING,
  words: [...NOTIFICATIONS_SETTING.words, words.notificationUpdates],
});

/** @type {SettingRow} */
export const REMINDERS_SETTING = {
  key: "settings:reminders",
  name: ["Game reminders", "Before the game"],
  words: ["remind", "reminders", "before game", "before the game", "game notifications", "timing"],
};
/** @type {SettingRow} */
export const ATHLETIC_SETTING = {
  key: "settings:paywalled",
  name: ["Include content from The Athletic"],
  words: ["the athletic", "paywall", "news sources", "outlets"],
};
/** @type {SettingRow} */
export const DIAGNOSTICS_SETTING = {
  key: "settings:diagnostics",
  name: ["Diagnostics"],
  words: ["diagnostics", "report"],
};

/**
 * The row of the switch for a team's own outlets.
 * @param {string} team the team's name, as the row says it
 * @param {string[]} [words] what else finds it, like what the league's fans call its outlets
 * @returns {SettingRow}
 */
export const describeTeamOutletsSetting = (team, words = []) => ({
  key: "settings:team-outlets",
  name: [`Include dedicated ${team} sources`],
  words: ["dedicated sources", ...words, "news sources", "outlets"],
});

/**
 * The row of the Appearance setting, found by its themes' names too.
 * @param {string[]} themes
 * @returns {SettingRow}
 */
export const describeAppearanceSetting = (themes) => ({
  key: "settings:appearance",
  name: ["Appearance"],
  words: ["appearance", "theme", "dark mode", "light mode", ...themes],
});

/**
 * The settings a search can open: those the page shows, as `isShown` says by key.
 * @param {SettingRow[]} rows
 * @param {(key: string) => boolean} isShown
 * @returns {PagePlace[]}
 */
const listSettings = (rows, isShown) =>
  rows
    .filter(({ key }) => isShown(key))
    .map(({ key, name, words }) => ({
      key,
      name: ["Settings", ...name],
      words: key === "settings" ? words : ["settings", ...words],
      icon: "settings",
    }));

/**
 * Every story the News tab shows, for a team's news to list its newest.
 * @param {{ cards?: import("./news-picks.js").NewsCard[] } | null | undefined} news the store's
 * @param {import("./news-picks.js").NewsChoices} choices the outlets the device reads
 * @param {import("./news-picks.js").OutletSwitches} outletSwitches the league's
 * @returns {NewsStory[]}
 */
export const listShownStories = (news, choices, outletSwitches) =>
  pickReadCards(news?.cards ?? [], choices, outletSwitches).flatMap((card) => [
    card.lead,
    ...card.more,
  ]);

/**
 * Stories, newest first.
 * @param {NewsStory[]} stories
 */
const listNewestFirst = (stories) =>
  [...stories].sort(
    (first, second) => Date.parse(second.publishedAt) - Date.parse(first.publishedAt),
  );

/**
 * The teams, players, and places a search of a season can open, each team with its record.
 * @param {LeaguePages} league
 * @param {{ index: { players: PagePlayer[] } | null, isSettingShown: (key: string) => boolean, standings?: { team: string, wins: number, losses: number }[], stories?: NewsStory[] }} shown
 *   each team's record in the standings, and the stories the News tab shows
 * @returns {SearchPages}
 */
export function composeSearchPages(
  league,
  { index, isSettingShown, standings = [], stories = [] },
) {
  const records = new Map(standings.map((row) => [row.team, `${row.wins}-${row.losses}`]));
  return {
    teams: league.teams.map((team) => ({
      ...team,
      ...(records.has(team.code) && { record: records.get(team.code) }),
    })),
    players: (index?.players ?? []).map(({ id, team, firstName, lastName, number, out }) => ({
      id,
      team,
      firstName,
      lastName,
      number,
      out: out ?? null,
    })),
    section: ROSTER_SECTION,
    places: [...league.places, ...listSettings(league.settings, isSettingShown)],
    gameParts: [HIGHLIGHTS_PART, ...league.gameParts],
    examples: league.examples,
    isOutKnown: league.isOutKnown,
    news: { place: NEWS_TAB, stories: listNewestFirst(stories) },
  };
}
