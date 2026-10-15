// A box score that shows a player in a game under way, or in one that ended today, says he's off
// the injured list sooner than the injury report the store reads once an hour does. His button in it
// carries that to the sheet it opens, which then trusts it over the report and leaves out its box.

import { html } from "./html.js";

/**
 * Whether the players a box score shows are playing now: its game is under way, or ended today.
 * @param {string | undefined} state the game's, as "live" or "final"
 * @param {boolean} isToday whether the game is today's
 */
export const isPlayingNow = (state, isToday) => state === "live" || (state === "final" && isToday);

/**
 * What a player's button adds to its attributes when a box score shows the player playing now.
 * @param {boolean} isShownPlaying
 */
export const markPlayingNow = (isShownPlaying) => isShownPlaying && html` data-player-playing="1"`;

/**
 * Whether the button that opened a player's sheet showed the player playing now.
 * @param {DOMStringMap} dataset the button's
 */
export const readPlayingNow = (dataset) => dataset.playerPlaying === "1";
