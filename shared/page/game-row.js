import { html } from "./html.js";

/** @typedef {import("./html.js").Markup} Markup */

/** @param {(string | false)[]} names */
const joinClasses = (...names) => names.filter(Boolean).join(" ");

/**
 * One club's half of a game row.
 * @typedef {object} GameRowSide
 * @property {Markup} lines the club, and any facts under it
 * @property {(string | false)[]} [classes] falsy ones are left out
 * @property {Markup | false} [extra] a line of its own under the side, like a starter; false
 *   leaves none, and empty markup still holds the line's place
 */

/**
 * A game in a list, as game-row.css lays it out: the away and home sides face each other across
 * the middle, which holds the time or score, with an optional label over it and status under it.
 * An action, like a button that opens the game, may cover the whole row, which a press of it tints
 * past the row's sides (controls.css).
 * @param {{ id?: string, classes?: (string | false)[], away: GameRowSide, home: GameRowSide, label?: Markup | false, headline: Markup, status?: Markup | false, action?: Markup | false }} row
 */
export const renderGameRow = ({
  id,
  classes = [],
  away,
  home,
  label = false,
  headline,
  status = false,
  action = false,
}) =>
  html`<li class="${joinClasses("game-row", action && "press-tint press-reach", ...classes)}"${id && html` data-game="${id}"`}>
    ${renderSide(away, "away")}
    <span class="game-middle"
      >${label && html`<span class="game-label">${label}</span>`}<span class="game-headline">${headline}</span
      >${status && html`<span class="game-status">${status}</span>`}</span
    >
    ${renderSide(home, "home")} ${renderExtra(away, "away")} ${renderExtra(home, "home")} ${action}
  </li>`;

/**
 * @param {GameRowSide} side
 * @param {"away" | "home"} place
 */
const renderSide = (side, place) =>
  html`<span class="${joinClasses("game-side", place, ...(side.classes ?? []))}">${side.lines}</span>`;

/**
 * @param {GameRowSide} side
 * @param {"away" | "home"} place
 */
const renderExtra = (side, place) =>
  side.extra ? html`<span class="game-extra ${place}">${side.extra}</span>` : html``;

// A game's row's button, or a game's card on a team's sheet (game-cards.js).
/** @param {Event} event */
const findOpenButton = (event) =>
  /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (event.target).closest(".game-open, .game-card-button")
  );

/**
 * Opens a game when its row's button, or its card, is tapped, and starts loading what it shows as
 * soon as a finger or pointer comes down on the button, so the wait for it is shorter by the tap's
 * length.
 * @param {HTMLElement} lists the element that holds the game rows or cards
 * @param {{ open: (button: HTMLElement) => void, prepare: (button: HTMLElement) => void }} actions
 */
export function watchGameOpens(lists, { open, prepare }) {
  lists.addEventListener("pointerdown", (event) => {
    const button = findOpenButton(event);
    if (button) prepare(button);
  });
  lists.addEventListener("click", (event) => {
    const button = findOpenButton(event);
    if (button) open(button);
  });
}
