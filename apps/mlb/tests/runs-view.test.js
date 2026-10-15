import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Markup, convertToText } from "#shared/html.js";
import { describeScoringPlay, describeSetup, renderRuns } from "../page/js/runs-view.js";
import { describeBoxScore } from "../worker/src/box-score.js";

// MLB's live feed for NLCS Game 1 as it stood with one out in the top of the 3rd, and for ALDS
// Game 4 once it was final, trimmed to what the box score reads, plays and all.
const PLAYS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-plays.json`, "utf8"),
);
const DODGERS_AT_BREWERS = { id: "849809", away: "LAD", home: "MIL" };
const GUARDIANS_AT_WHITE_SOX = { id: "849832", away: "CLE", home: "CWS" };
const PART_LINES =
  /<(h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>|<span class="runs-runner-name">([\s\S]*?)<\/span>\s*<\/div>/g;

/** @param {{ id: string }} game */
const describeGame = (game) => describeBoxScore(game.id, PLAYS.feeds[game.id]);

/** @param {string} markup */
const readText = (markup) => convertToText(new Markup(markup)).replace(/\s+/g, " ").trim();

/**
 * The part's text, a line for its title, each half inning's heading, each change of the score, and
 * each runner's name.
 * @param {any} game
 * @param {any} boxScore
 */
const readRuns = (game, boxScore) =>
  [...String(renderRuns(game, boxScore)).matchAll(PART_LINES)].map((match) =>
    readText(match[2] ?? match[3]),
  );

/**
 * One play of a half inning, a batter who got on unless it says otherwise.
 * @param {Partial<import("../page/js/runs-view.js").HalfPlay>} play
 */
const createPlay = (play) => ({
  batter: "Kwan",
  event: "Single",
  reached: true,
  filledBases: false,
  scorers: [],
  score: null,
  ...play,
});

test("a final's Runs give each half inning that scored under a heading without a score, with a line for each change of the score and who got on before it", () => {
  const lines = readRuns(GUARDIANS_AT_WHITE_SOX, describeGame(GUARDIANS_AT_WHITE_SOX));

  assert.deepEqual(lines, [
    "Runs",
    "Bottom 3rd",
    "Montgomery singled, Meidroth doubled, and Vargas walked, loading the basesMurakami walked, forcing in Montgomery0-1",
    "Antonacci's sac fly scored Meidroth0-2",
    "Top 5th",
    "Bailey homered1-2",
    "Kwan singledRamírez homered, scoring Kwan3-2",
    "Bottom 5th",
    "Meidroth and Vargas walked and Murakami singled, loading the basesAntonacci was hit by a pitch, forcing in Meidroth3-3",
    "Doyle's sac fly scored Vargas3-4",
    "Top 6th",
    "Martínez was hit by a pitchBazzana doubled home Martínez4-4",
    "Bailey singled home Bazzana5-4",
    "Rocchio and Kwan walked, loading the basesRamírez singled home Bailey6-4",
    "DeLauter singled home Rocchio7-4",
    "Adell singled home Ramírez and Kwan9-4",
    "Bottom 9th",
    "Vargas homered9-5",
  ]);
});

test("each score sets the club that changed it in bold", () => {
  const markup = String(renderRuns(GUARDIANS_AT_WHITE_SOX, describeGame(GUARDIANS_AT_WHITE_SOX)));

  assert.match(markup, /<span class="runs-score"><b>4<\/b>-4<\/span>/);
  assert.match(markup, /<span class="runs-score">3-<b>4<\/b><\/span>/);
});

test("a game being played has its Runs so far, then who's on base, how each got there, and who's up", () => {
  const boxScore = describeGame(DODGERS_AT_BREWERS);
  const markup = String(renderRuns(DODGERS_AT_BREWERS, boxScore));

  assert.deepEqual(readRuns(DODGERS_AT_BREWERS, boxScore), [
    "Runs so far",
    "Top 2nd",
    "Ohtani walked and Hernández singledPages singled home Ohtani1-0",
    "NowTop 3rd",
    "Bettssingled",
    "Smith up against Misiorowski",
  ]);
  assert.match(markup, /aria-label="1 out"/);
  assert.equal([...markup.matchAll(/class="runs-base taken"/g)].length, 1, "only 1st is taken");
});

test("a game being played with no runs yet says so over the field", () => {
  const boxScore = { ...describeGame(DODGERS_AT_BREWERS), scoringHalves: [] };

  assert.deepEqual(readRuns(DODGERS_AT_BREWERS, boxScore).slice(0, 3), [
    "Runs so far",
    "No runs yet",
    "NowTop 3rd",
  ]);
});

test("between halves of an inning, the field is empty and says who's due up", () => {
  const bases = {
    half: "middle",
    inning: 3,
    outs: 3,
    runners: [],
    batter: "Smith",
    pitcher: "Misiorowski",
  };
  const boxScore = { ...describeGame(DODGERS_AT_BREWERS), bases };
  const markup = String(renderRuns(DODGERS_AT_BREWERS, boxScore));

  assert.deepEqual(readRuns(DODGERS_AT_BREWERS, boxScore).slice(3), [
    "NowMid 3rd",
    "Smith due up against Misiorowski",
  ]);
  assert.match(markup, /runs-field/);
  assert.match(markup, /aria-label="3 outs"/);
  assert.doesNotMatch(markup, /class="runs-base taken"/);
});

test("a box score that doesn't say where the game stands has no field", () => {
  const boxScore = { ...describeGame(DODGERS_AT_BREWERS), bases: null };

  assert.doesNotMatch(String(renderRuns(DODGERS_AT_BREWERS, boxScore)), /runs-field/);
});

test("a box score kept before it kept each half inning's plays has no Runs", () => {
  const { scoringHalves, ...boxScore } = describeGame(GUARDIANS_AT_WHITE_SOX);

  assert.ok(scoringHalves.length > 0);
  assert.equal(String(renderRuns(GUARDIANS_AT_WHITE_SOX, boxScore)), "");
});

test("each way a run scores reads as a fan would say it", () => {
  const score = { away: 1, home: 0 };
  const scorers = (/** @type {string} */ event) => [{ name: "Ohtani", event }];

  assert.deepEqual(
    [
      describeScoringPlay(createPlay({ event: "Triple", scorers: scorers("Triple"), score })),
      describeScoringPlay(createPlay({ event: "Walk", scorers: scorers("Walk"), score })),
      describeScoringPlay(createPlay({ event: "Walk", scorers: scorers("Walk"), score }), true),
      describeScoringPlay(
        createPlay({ event: "Groundout", reached: false, scorers: scorers("Groundout"), score }),
      ),
      describeScoringPlay(
        createPlay({
          event: "Sac Fly",
          batter: "Lewis",
          reached: false,
          scorers: scorers("Sac Fly"),
          score,
        }),
      ),
      describeScoringPlay(
        createPlay({ event: "Strikeout", reached: false, scorers: scorers("Wild Pitch"), score }),
      ),
      describeScoringPlay(createPlay({ event: "Walk", scorers: scorers("Passed Ball"), score })),
      describeScoringPlay(
        createPlay({ event: "Field Error", scorers: scorers("Field Error"), score }),
      ),
    ],
    [
      "Kwan tripled home Ohtani",
      "Kwan walked with the bases loaded, forcing in Ohtani",
      "Kwan walked, forcing in Ohtani",
      "Kwan grounded out, scoring Ohtani",
      "Lewis' sac fly scored Ohtani",
      "Ohtani scored on a wild pitch",
      "Kwan walked and Ohtani scored on a passed ball",
      "Kwan reached on an error, scoring Ohtani",
    ],
  );
});

test("runners who got on the same way in a row are named together, and the one who loaded the bases says so", () => {
  assert.equal(
    describeSetup([
      createPlay({ batter: "Meidroth", event: "Walk" }),
      createPlay({ batter: "Vargas", event: "Walk" }),
      createPlay({ batter: "Murakami", event: "Hit By Pitch", filledBases: true }),
    ]),
    "Meidroth and Vargas walked and Murakami was hit by a pitch, loading the bases",
  );
});

test("runners who got on after a half inning's last change of the score aren't in its lines", () => {
  const [, , bottomOfFifth] = describeGame(GUARDIANS_AT_WHITE_SOX).scoringHalves;
  const lines = readRuns(GUARDIANS_AT_WHITE_SOX, {
    ...describeGame(GUARDIANS_AT_WHITE_SOX),
    scoringHalves: [bottomOfFifth],
  });

  assert.ok(bottomOfFifth.plays.some((/** @type {any} */ play) => play.batter === "Teel"));
  assert.doesNotMatch(lines.join("\n"), /Teel/);
});
