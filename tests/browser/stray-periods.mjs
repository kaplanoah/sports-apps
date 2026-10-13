import { listShownTexts } from "./shown-text.mjs";

const SENTENCE_BREAK = /[.!?]["”)]?\s+\S/;
const ABBREVIATION_END = /\b(Jr|Sr|St|vs|No)\.$/;

/** @param {string} text */
const isStrayPeriod = (text) =>
  text.endsWith(".") && !ABBREVIATION_END.test(text) && !SENTENCE_BREAK.test(text.slice(0, -1));

/**
 * Every shown block of text that ends in a period but holds only one sentence. A label, an empty
 * view's note, or a setting's note stands alone without one; only text of two or more sentences,
 * like a release note or a message that says what to do, ends in a period. An outlet's own words
 * keep their punctuation, and so does a name that ends in an abbreviation, like Jr.
 * @param {import("@playwright/test").Page} page
 */
export const listStrayPeriods = async (page) => (await listShownTexts(page)).filter(isStrayPeriod);
