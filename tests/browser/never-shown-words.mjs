import { findNeverShownWords } from "../../shared/page/league-words.js";
import { listShownTexts } from "./shown-text.mjs";

/**
 * Every shown block of text that holds a word its league never shows, like "postseason" in either
 * app. An outlet's own words keep theirs.
 * @param {import("@playwright/test").Page} page
 * @param {string[]} neverShown the league's, from its `league-words.js`
 */
export const listNeverShownWords = async (page, neverShown) =>
  (await listShownTexts(page)).filter((text) => findNeverShownWords(text, neverShown).length);
