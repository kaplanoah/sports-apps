// What's new in the app, newest first, for the Updates box. A note goes here only when the repo's
// owner asks for one, timed as it ships.

import { html } from "#shared/html.js";

/** @type {import("#shared/updates.js").ReleaseNote[]} */
export const RELEASE_NOTES = [
  {
    at: "2026-10-28T01:02:00Z",
    text: html`Get a notification before each playoff game. In settings at the top right, turn on <b>Game starts</b> under Notifications, and pick how long before the game.`,
  },
  {
    at: "2026-10-16T03:45:00Z",
    text: html`<b>Bracket</b> and <b>Standings</b> are combined into one page. Tap the buttons at the top of the page to switch between them. In the regular season, standings show by default. In the playoffs, the bracket shows by default.`,
  },
  {
    at: "2026-10-13T15:23:00Z",
    text: html`Search for teams, players, games, and highlights, with the <b>Search</b> button at the bottom. (Includes the old game search, which works the same as before.)`,
  },
  {
    at: "2026-10-10T19:49:00Z",
    text: html`Game highlights for finished games, including recap videos and big play clips. Tap a game, then tap <b>Highlights</b> or swipe left.`,
  },
];
