// What's new in the app, newest first, for the Updates box. A note goes here only when the repo's
// owner asks for one, timed as it ships.

import { html } from "#shared/html.js";

/** @type {import("#shared/updates.js").ReleaseNote[]} */
export const RELEASE_NOTES = [
  {
    at: "2026-10-13T15:23:00Z",
    text: html`Search for teams, players, games, and highlights, with the <b>Search</b> button at the bottom. (Includes the old game search, which works the same as before.)`,
  },
  {
    at: "2026-10-10T19:49:00Z",
    text: html`Game highlights for finished games, including recap videos and big play clips. Tap a game, then tap <b>Highlights</b> or swipe left.`,
  },
];
