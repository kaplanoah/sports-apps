// What's new in the app, newest first, for the Updates box. A note goes here only when the repo's
// owner asks for one, timed as it ships.

import { html } from "#shared/html.js";

/** @type {import("#shared/updates.js").ReleaseNote[]} */
export const RELEASE_NOTES = [
  {
    at: "2026-10-29T04:13:00Z",
    text: html`Send a feature request, bug report, or anything else. From settings in the top right, tap <b>Contact</b>.`,
  },
  {
    at: "2026-10-28T01:02:00Z",
    text: html`Get a notification before each playoff game. In settings at the top right, turn on <b>Game starts</b> under Notifications, and pick how long before tipoff.`,
  },
  {
    at: "2026-10-16T03:45:00Z",
    text: html`<b>Bracket</b> and <b>Standings</b> are combined into one page. Tap the buttons at the top of the page to switch between them. In the regular season, standings show by default. In the playoffs, the bracket shows by default.`,
  },
  {
    at: "2026-10-12T21:05:00Z",
    text: html`Search for teams, players, games, and highlights, with the <b>Search</b> button at the bottom. (Includes the old game search, which works the same as before.)`,
  },
  {
    at: "2026-10-11T19:25:00Z",
    text: "If a player is out, for example because of an injury or pregnancy, their player page shows why they're out",
  },
  {
    at: "2026-10-10T19:49:00Z",
    text: html`Game highlights for finished games, including recap videos and big play clips. Tap a game, then tap <b>Highlights</b> or swipe left.`,
  },
  {
    at: "2026-10-09T12:19:00Z",
    text: "The Games tab now shows the whole season, from opening night to the Finals",
  },
  {
    at: "2026-10-07T22:35:00Z",
    text: html`Player pages now include turnover stats. From a team page, tap <b>Roster</b> and then a player's name.`,
  },
  {
    at: "2026-10-06T14:55:00Z",
    text: "More leading scorers shown on team and game pages, with more stats for each scorer, and player names are now tappable",
  },
  {
    at: "2026-10-06T04:37:00Z",
    text: html`Team rosters. Tap on a team in the bracket, standings, or a game's details page, then swipe left or tap <b>Roster</b>.`,
  },
  {
    at: "2026-10-05T03:31:00Z",
    text: "A News tab with WNBA stories and analysis from curated sources including ESPN, The Athletic, The IX, and beat writers. Configure teams and paywalled content in settings at the top right.",
  },
  {
    at: "2026-10-02T17:15:00Z",
    text: "Game details now include which channels it's playing on. Tap a game to view details.",
  },
];
