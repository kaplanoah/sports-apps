import test from "node:test";
import assert from "node:assert/strict";
import { html } from "#shared/html.js";
import { listFoundDays, listSeasonDays } from "#shared/season-days.js";

const TODAY = "2026-10-10";
const GAME_DAYS = [
  { day: TODAY, count: 3, games: html`<ul class="game-list"><li>Three games</li></ul>` },
  { day: "2026-10-11", count: 1, games: html`<ul class="game-list"><li>One game</li></ul>` },
];

test("an offscreen game's day keeps its label, height, and today mark without drawing its games", () => {
  const days = listFoundDays({ gameDays: GAME_DAYS, today: TODAY, standsIn: true });
  const [today, tomorrow] = days.map(({ farMarkup }) => String(farMarkup));
  assert.match(today, /<section class="game-day is-today" style="--games: 3">/);
  assert.match(today, /aria-label="Saturday, Oct 10"/);
  assert.match(today, /<ul class="game-list is-stand-in" aria-hidden="true"><\/ul>/);
  assert.doesNotMatch(today, /Three games/);
  assert.match(tomorrow, /<section class="game-day" style="--games: 1">/);
  assert.match(tomorrow, /aria-label="Tomorrow, Oct 11"/);
  assert.doesNotMatch(tomorrow, /One game/);
});

test("only a list that asks for stand-ins gets offscreen markup, in search and the season", () => {
  const options = { gameDays: GAME_DAYS, today: TODAY, emptyNote: "No games" };
  for (const standsIn of [false, true]) {
    const found = listFoundDays({ ...options, standsIn });
    const season = listSeasonDays({ ...options, standsIn }).days;
    for (const days of [found, season])
      for (const day of days) assert.equal(Object.hasOwn(day, "farMarkup"), standsIn);
  }
  assert.ok(listFoundDays(options).every((day) => !Object.hasOwn(day, "farMarkup")));
  assert.ok(listSeasonDays(options).days.every((day) => !Object.hasOwn(day, "farMarkup")));
});
