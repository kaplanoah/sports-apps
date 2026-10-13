import { html } from "#shared/html.js";

/** @typedef {import("#shared/html.js").Markup} Markup */

/**
 * A button around a player's name that opens his sheet, showing his name, or what's given in its
 * place, like his first and last names on lines of their own.
 * @param {{ id: number, name: string, number?: string }} player
 * @param {string} club
 * @param {{ content?: Markup | string, className?: string }} [shown]
 */
export const renderPlayerButton = (
  player,
  club,
  { content = player.name, className = "box-name" } = {},
) =>
  html`<button type="button" class="player-open ${className}" data-player="${String(player.id)}" data-player-team="${club}" data-player-name="${player.name}" data-player-number="${player.number ?? ""}">${content}</button>`;
