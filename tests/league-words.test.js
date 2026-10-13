import test from "node:test";
import assert from "node:assert/strict";
import { findNeverShownWords } from "../shared/page/league-words.js";
import { LEAGUE_WORDS as MLB_WORDS } from "../apps/mlb/page/js/league-words.js";
import { RELEASE_NOTES as MLB_NOTES } from "../apps/mlb/page/js/release-notes.js";
import { LEAGUE_WORDS as WNBA_WORDS } from "../apps/wnba/page/js/league-words.js";
import { RELEASE_NOTES as WNBA_NOTES } from "../apps/wnba/page/js/release-notes.js";

const LEAGUES = [
  { app: "mlb", words: MLB_WORDS, notes: MLB_NOTES },
  { app: "wnba", words: WNBA_WORDS, notes: WNBA_NOTES },
];

test("a never-shown word is found whole, in any case, and never inside another word", () => {
  const neverShown = ["postseason", "post-season", "wild card"];
  assert.deepEqual(findNeverShownWords("Postseason games", neverShown), ["postseason"]);
  assert.deepEqual(findNeverShownWords("Post-season final scores", neverShown), ["post-season"]);
  assert.deepEqual(findNeverShownWords("In the last Wild Card spot", neverShown), ["wild card"]);
  assert.deepEqual(findNeverShownWords("Playoffs, postseasons, and post-seasonal", neverShown), []);
});

test("each league's own words and release notes hold none of the words it never shows", () => {
  for (const { app, words, notes } of LEAGUES) {
    const { neverShown, ...shown } = words;
    assert.deepEqual(findNeverShownWords(JSON.stringify(shown), neverShown), [], app);
    for (const note of notes)
      assert.deepEqual(findNeverShownWords(String(note.text), neverShown), [], note.at);
  }
});
