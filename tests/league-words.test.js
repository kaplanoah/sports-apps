import test from "node:test";
import assert from "node:assert/strict";
import { findNeverShownWords, nameSeason } from "../shared/page/league-words.js";
import { listApps } from "../worker/apps.mjs";

const LEAGUES = await Promise.all(
  listApps().map(async (app) => ({
    app,
    words: (await import(`../apps/${app}/page/js/league-words.js`)).LEAGUE_WORDS,
    notes: (await import(`../apps/${app}/page/js/release-notes.js`)).RELEASE_NOTES,
  })),
);

test("a never-shown word is found whole, in any case, and never inside another word", () => {
  const neverShown = ["postseason", "post-season", "wild card"];
  assert.deepEqual(findNeverShownWords("Postseason games", neverShown), ["postseason"]);
  assert.deepEqual(findNeverShownWords("Post-season final scores", neverShown), ["post-season"]);
  assert.deepEqual(findNeverShownWords("In the last Wild Card spot", neverShown), ["wild card"]);
  assert.deepEqual(findNeverShownWords("Playoffs, postseasons, and post-seasonal", neverShown), []);
});

test("a season is named by its year, or by both years when it runs into the next, as fans write 2025-26", () => {
  assert.equal(nameSeason(2026, { seasonSpansYears: false }), "2026");
  assert.equal(nameSeason(2025, { seasonSpansYears: true }), "2025-26");
  assert.equal(nameSeason(2008, { seasonSpansYears: true }), "2008-09");
  assert.equal(nameSeason(2099, { seasonSpansYears: true }), "2099-00");
});

test("each league's own words and release notes hold none of the words it never shows", () => {
  for (const { app, words, notes } of LEAGUES) {
    const { neverShown, ...shown } = words;
    assert.deepEqual(findNeverShownWords(JSON.stringify(shown), neverShown), [], app);
    for (const note of notes)
      assert.deepEqual(findNeverShownWords(String(note.text), neverShown), [], note.at);
  }
});
