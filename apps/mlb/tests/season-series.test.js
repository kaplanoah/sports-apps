import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../page/js/snapshot.js";
import { renderSeasonSeries } from "../page/js/season-series.js";

/** @param {string} name */
const loadFixture = (name) =>
  JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}.json`, "utf8"));

// The evening of Oct 7, with MLB's whole 2026 schedule as recorded on Oct 9.
const EVENING = loadFixture("2026-10-07-broadcasts");
const SEASON = loadFixture("2026-10-09-season");
const SNAPSHOT = buildSnapshot(
  { ...EVENING.responses, seasonGames: SEASON.responses.seasonGames },
  { season: EVENING.season, now: Date.parse(EVENING.now) },
);
const GAMES = Object.values(SNAPSHOT.schedule).flat();

/** @param {unknown} markup */
const readText = (markup) =>
  String(markup)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** @param {unknown} markup */
const listMeetings = (markup) =>
  [...String(markup).matchAll(/<li>(.*?)<\/li>/gs)].map(([, row]) => readText(row));

const BREWERS_AT_PADRES = { away: "MIL", home: "SD", state: "pre", postseason: true };

test("a postseason game still to come lists its clubs' regular season meetings, each winner's score and where, under who won the series", () => {
  const markup = renderSeasonSeries(BREWERS_AT_PADRES, GAMES);
  assert.match(String(markup), /<h3>Season series<\/h3>\s*<span>Padres won 4-2<\/span>/);
  assert.deepEqual(listMeetings(markup), [
    "May 12 Brewers 6-4 vs Padres",
    "May 13 Padres 3-1 at Brewers",
    "May 14 Brewers 7-1 vs Padres",
    "Aug 10 Padres 3-2 vs Brewers",
    "Aug 11 Padres 11-2 vs Brewers",
    "Aug 12 Padres 4-3 vs Brewers",
  ]);
});

test("each meeting's winner opens his club's sheet", () => {
  assert.match(
    String(renderSeasonSeries(BREWERS_AT_PADRES, GAMES)),
    /<span class="meeting-result"><button type="button" class="club team-open" data-team="MIL"/,
  );
});

test("during the regular season the series says who leads it, or that it's tied, and a series over that came out even says split", () => {
  const regularSeason = { ...BREWERS_AT_PADRES, postseason: false };
  const firstThree = GAMES.filter((game) => game.date < "2026-06-01");
  assert.match(
    String(renderSeasonSeries(regularSeason, firstThree)),
    /<span>Brewers lead 2-1<\/span>/,
  );

  const firstTwo = GAMES.filter((game) => game.date < "2026-05-14");
  assert.match(String(renderSeasonSeries(regularSeason, firstTwo)), /<span>Tied 1-1<\/span>/);
  assert.match(String(renderSeasonSeries(BREWERS_AT_PADRES, firstTwo)), /<span>Split 1-1<\/span>/);
});

test("clubs that haven't met say so, and a game under way or over, one without both clubs, or one before the season's games load shows no series", () => {
  assert.equal(
    readText(renderSeasonSeries({ ...BREWERS_AT_PADRES, away: "NYY" }, [])),
    "Season series They haven't met this season",
  );
  assert.equal(renderSeasonSeries({ ...BREWERS_AT_PADRES, state: "live" }, GAMES), false);
  assert.equal(renderSeasonSeries({ ...BREWERS_AT_PADRES, state: "final" }, GAMES), false);
  assert.equal(renderSeasonSeries({ ...BREWERS_AT_PADRES, away: null }, GAMES), false);
  assert.equal(renderSeasonSeries(BREWERS_AT_PADRES, null), false);
});
