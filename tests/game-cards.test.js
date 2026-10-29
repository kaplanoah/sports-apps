import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGameCards } from "../shared/page/game-cards.js";
import { html } from "../shared/page/html.js";

const NOW = new Date(2026, 8, 30, 17, 55);

/**
 * A card of Storm at Sky, as `fields` change it.
 * @param {Partial<import("../shared/page/game-cards.js").GameCard>} fields
 * @returns {import("../shared/page/game-cards.js").GameCard}
 */
const describeCard = (fields) => ({
  id: "1022600400",
  state: "pre",
  day: null,
  clock: "",
  score: null,
  time: "7:00 PM",
  isHome: false,
  dot: html``,
  opponent: "Sky",
  ...fields,
});

/**
 * The markup of the card's line over its score.
 * @param {Partial<import("../shared/page/game-cards.js").GameCard>} fields
 */
function readWhen(fields) {
  const cards = renderGameCards([describeCard(fields)], NOW);
  const text = cards ? cards.text : "";
  return text.match(
    /<span class="game-card-when">([\s\S]*?)<\/span>\s*<span class="game-card-line">/,
  )?.[1];
}

const WON = { own: 80, theirs: 75 };

test("a card names yesterday, today, and tomorrow, and any other day by its date", () => {
  assert.equal(readWhen({ state: "final", score: WON, day: new Date(2026, 8, 28) }), "Sep 28");
  assert.equal(readWhen({ state: "final", score: WON, day: new Date(2026, 8, 29) }), "Yesterday");
  assert.equal(readWhen({ state: "final", score: WON, day: new Date(2026, 8, 30) }), "Today");
  assert.equal(readWhen({ day: new Date(2026, 9, 1) }), "Tomorrow");
  assert.equal(readWhen({ day: new Date(2026, 9, 2) }), "Oct 2");
});

test("a game still to come today stands out as a game being played does, and one over today doesn't", () => {
  assert.equal(
    readWhen({ day: new Date(2026, 8, 30) }),
    '<span class="game-card-now">Today</span>',
  );
  assert.equal(
    readWhen({ state: "live", score: WON, day: new Date(2026, 8, 30), clock: "Q3 4:12" }),
    '<span class="game-card-now">Q3 4:12</span>',
  );
  assert.equal(readWhen({ state: "final", score: WON, day: new Date(2026, 8, 30) }), "Today");
});

test("a card without a day leaves the line empty", () => {
  assert.equal(readWhen({ day: null }), "");
});

test("a card's button is named by what it shows, then that it opens the game", () => {
  const text = renderGameCards([describeCard({ day: new Date(2026, 9, 2) })], NOW)?.text ?? "";

  assert.match(text, /<span class="spoken-only">, game details<\/span>\s*<\/button>/);
  assert.doesNotMatch(text, /aria-label/);
});
