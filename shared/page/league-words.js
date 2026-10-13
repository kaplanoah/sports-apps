// What a league's pages call things, in the words its fans use. Shared code reads a league's words
// from here instead of typing its own, so each app shows only its league's.

/**
 * @typedef {object} LeagueWords
 * @property {string} seasonOpener its season's first game, as a fan says it mid-sentence
 * @property {string} allStar its All-Star Game
 * @property {string | null} cup its in-season cup, or null for a league without one
 * @property {boolean} hasDoubleheaders whether two teams can play each other twice in a day
 * @property {{ name: string, words: string[], games: string }} pastRegulation a final that went
 *   past regulation, and the games it finds
 * @property {{ name: string, words: string[] } | null} crossConference a game between its two
 *   leagues or conferences, or null where fans have no name for one
 * @property {string[]} neverShown words its pages never show, like another sport's or the press's
 */

/** @param {string} word */
const matchWholeWord = (word) =>
  new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i");

/**
 * Each of a league's never-shown words that a text holds as a whole word, in any case.
 * @param {string} text
 * @param {string[]} neverShown
 */
export const findNeverShownWords = (text, neverShown) =>
  neverShown.filter((word) => matchWholeWord(word).test(text));
