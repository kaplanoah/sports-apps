import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Markup, convertToText } from "#shared/html.js";
import { describeRunPlay, renderRuns } from "../page/js/runs-view.js";
import { describeBoxScore } from "../worker/src/box-score.js";

// MLB's live feed for NLCS Game 1 as it stood with one out in the top of the 3rd, and for ALDS
// Game 4 once it was final, trimmed to what the box score reads, plays and all.
const PLAYS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-plays.json`, "utf8"),
);
const DODGERS_AT_BREWERS = { id: "849809", away: "LAD", home: "MIL" };
const GUARDIANS_AT_WHITE_SOX = { id: "849832", away: "CLE", home: "CWS" };

/** @param {{ id: string }} game */
const describeGame = (game) => describeBoxScore(game.id, PLAYS.feeds[game.id]);

const PART_LINES =
  /<(h3|p)\b[^>]*>([\s\S]*?)<\/\1>|<span class="runs-runner-name">([\s\S]*?)<\/span>\s*<\/div>/g;

/**
 * The part's text, a line for its title, each of its paragraphs, and each runner's name.
 * @param {any} game
 * @param {any} boxScore
 */
const readRuns = (game, boxScore) =>
  [...String(renderRuns(game, boxScore)).matchAll(PART_LINES)].map((match) =>
    convertToText(new Markup(match[2] ?? match[3]))
      .replace(/\s+/g, " ")
      .trim(),
  );

test("a final's Runs say how each club scored, inning by inning, with no one on base", () => {
  const lines = readRuns(GUARDIANS_AT_WHITE_SOX, describeGame(GUARDIANS_AT_WHITE_SOX));

  assert.deepEqual(lines, [
    "Runs",
    "Guardians 9 on Bailey's solo homer and Ramírez's 2-run homer in the 5th, then Bazzana's RBI double, Bailey's RBI single, Ramírez's RBI single, DeLauter's RBI single, and Adell's 2-run single in the 6th",
    "White Sox 5 on Murakami's bases-loaded walk and Antonacci's sac fly in the 3rd, then Antonacci's bases-loaded hit by pitch and Doyle's sac fly in the 5th, then Vargas' solo homer in the 9th",
  ]);
});

test("a game being played has its Runs so far, then who's on base, how each got there, and who's up", () => {
  const markup = String(renderRuns(DODGERS_AT_BREWERS, describeGame(DODGERS_AT_BREWERS)));
  const lines = readRuns(DODGERS_AT_BREWERS, describeGame(DODGERS_AT_BREWERS));

  assert.deepEqual(lines, [
    "Runs so far",
    "Dodgers 1 on Pages' RBI single in the 2nd",
    "Brewers 0",
    "NowTop 3rd",
    "Bettssingled",
    "Smith is up against Misiorowski",
  ]);
  assert.match(markup, /aria-label="1 out"/);
  assert.equal([...markup.matchAll(/class="runs-base taken"/g)].length, 1, "only 1st is taken");
});

test("between halves of an inning, the Runs so far have no field", () => {
  const boxScore = { ...describeGame(DODGERS_AT_BREWERS), bases: null };

  assert.doesNotMatch(String(renderRuns(DODGERS_AT_BREWERS, boxScore)), /runs-field/);
});

test("a box score kept before it kept its plays has no Runs", () => {
  const { scoring, ...boxScore } = describeGame(GUARDIANS_AT_WHITE_SOX);

  assert.ok(scoring.length > 0);
  assert.equal(String(renderRuns(GUARDIANS_AT_WHITE_SOX, boxScore)), "");
});

test("each way a run scores reads as a fan would say it, crediting no one for what isn't a batter's", () => {
  /** @param {string} event @param {number} rbi @param {string} [player] */
  const describe = (event, rbi, player = "Kwan") =>
    describeRunPlay({ side: "away", inning: 1, event, player, rbi, runs: Math.max(rbi, 1) });

  assert.deepEqual(
    [
      describe("Home Run", 4),
      describe("Triple", 3),
      describe("Single", 0),
      describe("Intent Walk", 1),
      describe("Groundout", 1),
      describe("Grounded Into DP", 0),
      describe("Stolen Base Home", 0),
      describe("Wild Pitch", 0),
      describe("Field Error", 0),
      describe("Single", 1, "Lewis"),
    ],
    [
      "Kwan's grand slam",
      "Kwan's 3-run triple",
      "Kwan's single",
      "Kwan's bases-loaded intentional walk",
      "Kwan's RBI groundout",
      "Kwan's double play",
      "Kwan's steal of home",
      "a wild pitch",
      "an error",
      "Lewis' RBI single",
    ],
  );
});
