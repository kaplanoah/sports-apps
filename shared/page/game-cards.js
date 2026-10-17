// A team's nearest games across the top of its sheet, side by side: its last, the one it's playing,
// and its next, each under its title in a card that opens the game's sheet. A card says the game's
// day, as yesterday, today, or tomorrow when it's one of them, or its clock while it's on, over one
// line: the result and the score, how far the team is up or down, or the start time, then vs or @
// and the other team. Every score puts the team's own first. Each league hands it what each card
// shows, and fitGameCards sizes the cards once they're drawn.

import { countDaysBetween, formatShortDate, nameDay } from "./days.js";
import { html } from "./html.js";

/** @typedef {import("./html.js").Markup} Markup */
/**
 * @typedef {object} GameCard
 * @property {string} id the game's, which its sheet opens by
 * @property {string} label what the card's button says it opens, as "Sky at Storm, Aug 19"
 * @property {"final" | "live" | "pre"} state
 * @property {Date | null} day its day
 * @property {string} clock how far along it is, while it's on
 * @property {{ own: number, theirs: number } | null} score
 * @property {string} time when it starts, for a game not yet started
 * @property {boolean} isHome
 * @property {Markup} dot the other team's
 * @property {string} opponent the other team's name
 */

const TITLES = { final: "Last game", live: "Now", pre: "Next game" };

/** @param {number} margin */
const describeMargin = (margin) => (margin > 0 ? "UP" : margin < 0 ? "DOWN" : "TIED");

/** @param {{ own: number, theirs: number }} score */
const describePoints = ({ own, theirs }) => `${own}-${theirs}`;

/** @param {{ own: number, theirs: number }} score */
function renderResult(score) {
  const isWin = score.own > score.theirs;
  return html`<span class="game-card-result ${isWin ? "won" : "lost"}">${isWin ? "W" : "L"}</span>
    ${describePoints(score)}`;
}

/** @param {{ own: number, theirs: number }} score */
const renderMargin = (score) =>
  html`<span class="game-card-margin">${describeMargin(score.own - score.theirs)}</span>
    ${describePoints(score)}`;

/** @param {GameCard} card */
function renderScore({ state, score, time }) {
  if (state === "pre" || !score) return time;
  return state === "live" ? renderMargin(score) : renderResult(score);
}

/**
 * The game's clock while it's on, or its day, with a game still to come today standing out as one
 * being played does.
 * @param {GameCard} card
 * @param {Date} now
 */
function renderWhen({ state, day, clock }, now) {
  if (state === "live") return html`<span class="game-card-now">${clock}</span>`;
  if (!day) return "";
  const name = nameDay(day, now, { nameOtherDay: formatShortDate, isCapitalized: true });
  const isLaterToday = state === "pre" && countDaysBetween(now, day) === 0;
  return isLaterToday ? html`<span class="game-card-now">${name}</span>` : name;
}

/**
 * @param {GameCard} card
 * @param {Date} now
 */
const renderCard = (card, now) =>
  html`<div class="game-card">
    <div class="sheet-part-head"><h3>${TITLES[card.state]}</h3></div>
    <button
      type="button"
      class="game-card-button"
      data-game="${card.id}"
      aria-label="Game details: ${card.label}"
    >
      <span class="game-card-when">${renderWhen(card, now)}</span>
      <span class="game-card-line">
        <span class="game-card-score tabular">${renderScore(card)}</span>
        <span class="game-card-opponent"
          ><span class="game-card-at">${card.isHome ? "vs" : "@"}</span>${card.dot}<span
            class="game-card-name"
            >${card.opponent}</span
          ></span
        >
      </span>
    </button>
  </div>`;

/**
 * The cards in order, last, now, and next, or nothing when there are none.
 * @param {GameCard[]} cards
 * @param {Date} now
 */
export const renderGameCards = (cards, now) =>
  cards.length > 0 &&
  html`<div class="game-cards">${cards.map((card) => renderCard(card, now))}</div>`;

/**
 * @param {CSSStyleDeclaration} style
 * @param {string} name
 */
const readLength = (style, name) => parseFloat(style.getPropertyValue(name)) || 0;

/** @param {HTMLElement} row */
function readSpacing(row) {
  const style = getComputedStyle(row);
  return {
    leastGap: readLength(style, "--game-cards-gap-least"),
    mostGap: readLength(style, "--game-cards-gap-most"),
    leastPadding: readLength(style, "--game-card-padding-least"),
    mostPadding: readLength(style, "--game-card-padding-most"),
  };
}

/**
 * @param {Element} row
 * @param {string} selector
 */
const measureEach = (row, selector) =>
  [...row.querySelectorAll(selector)].map((element) => element.getBoundingClientRect().width);

/**
 * The widest line of the row's cards with each score beside its team, and with each over it. Every
 * piece is as wide as its own text either way, so the row is measured as it is.
 * @param {HTMLElement} row
 */
function measureWidestLines(row) {
  const titles = measureEach(row, ".game-card h3, .game-card-when");
  const scores = measureEach(row, ".game-card-score");
  const teams = measureEach(row, ".game-card-opponent");
  const line = /** @type {Element} */ (row.querySelector(".game-card-line"));
  const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
  return {
    beside: Math.max(...titles, ...scores.map((score, index) => score + gap + teams[index])),
    over: Math.max(...titles, ...scores, ...teams),
  };
}

/** @param {HTMLElement} row */
function measureBorders(row) {
  const card = /** @type {HTMLElement} */ (row.querySelector(".game-card-button"));
  const style = getComputedStyle(card);
  return parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
}

/**
 * How the row's cards fit: as wide as one another, as wide as the row's widest line, its titles
 * and days included, with room beside it up to the most padding, never less than the least. A row
 * whose lines don't fit that way sets each card's score over the other team. The cards spread
 * apart with the room the row has, from the least gap to the most.
 * @param {HTMLElement} row
 */
function chooseFit(row) {
  const count = row.querySelectorAll(".game-card").length;
  const room = row.clientWidth;
  const { leastGap, mostGap, leastPadding, mostPadding } = readSpacing(row);
  const borders = measureBorders(row);
  const share = (room - leastGap * (count - 1)) / count;
  const widest = measureWidestLines(row);
  const fitsBeside = widest.beside + 2 * leastPadding + borders <= share;
  const line = fitsBeside ? widest.beside : widest.over;
  const padding = Math.max(leastPadding, Math.min(mostPadding, (share - line - borders) / 2));
  const width = Math.min(share, line + 2 * padding + borders);
  const spare = count > 1 ? (room - width * count) / (count - 1) : leastGap;
  const gap = Math.min(mostGap, Math.max(leastGap, spare));
  return { isStacked: !fitsBeside, width: `${width}px`, gap: `${gap}px` };
}

/**
 * Sizes the cards in a row to fit it, changing the row only where its fit changed.
 * @param {HTMLElement} holder what holds the row, which may have none
 */
export function fitGameCards(holder) {
  const row = /** @type {HTMLElement | null} */ (holder.querySelector(".game-cards"));
  if (!row || row.clientWidth === 0) return;
  const { isStacked, width, gap } = chooseFit(row);
  if (row.classList.contains("is-stacked") !== isStacked)
    row.classList.toggle("is-stacked", isStacked);
  if (row.style.getPropertyValue("--game-card-width") !== width)
    row.style.setProperty("--game-card-width", width);
  if (row.style.getPropertyValue("--game-cards-gap") !== gap)
    row.style.setProperty("--game-cards-gap", gap);
}

/**
 * Fits the cards in `holder` again whenever its width changes, and whenever a font loads, since a
 * font loads only once a line first needs it, after the cards were measured in a stand-in.
 * @param {HTMLElement} holder
 */
export function watchGameCards(holder) {
  let width = 0;
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    fitGameCards(holder);
  }).observe(holder);
  document.fonts.addEventListener("loadingdone", () => fitGameCards(holder));
}
