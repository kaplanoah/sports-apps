import { html } from "#shared/html.js";
import { markPlayingNow } from "#shared/playing-now.js";

/** @typedef {import("#shared/html.js").Markup} Markup */

/**
 * A button around a player's name that opens her sheet, which her name names.
 * @param {{ id: string | number, team: string, firstName: string, lastName: string }} player
 * @param {Markup | string} content
 * @param {{ isPlayingNow?: boolean }} [shown] `isPlayingNow` says a box score shows her playing
 *   now (`#shared/playing-now.js`)
 */
export const renderPlayerButton = (player, content, { isPlayingNow = false } = {}) =>
  html`<button type="button" class="player-open" data-player="${String(player.id)}" data-player-team="${player.team}" data-player-name="${player.firstName} ${player.lastName}"${markPlayingNow(isPlayingNow)}>${content}</button>`;
