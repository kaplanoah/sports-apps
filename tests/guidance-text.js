// How the tests read the guidance files' markdown: what marks a list item or a heading, what
// starts a new unit of text, and a line's words, with each code span as one.

const LIST_MARK = String.raw`[-*]|\d+\.`;
const HEADING_MARK = "#+";
const LIST_START = String.raw`^\s*(?:${LIST_MARK})\s`;
const HEADING_START = String.raw`^(?:${HEADING_MARK})\s`;
const LEADING_MARK = new RegExp(String.raw`(?:${LIST_START}|${HEADING_START})\s*`);
const HEADING = new RegExp(HEADING_START);
const LIST_ITEM = new RegExp(LIST_START);
// A bold label's stop, like **Bugs.**, ends the label, not the sentence after it on its line.
const BOLD_LABEL_STOP = /^(\*\*[^*]+)[.?!](?=\*\*\s*\S)/;

export const isFence = (/** @type {string} */ line) => /^---\s*$/.test(line);
export const isHeading = (/** @type {string} */ line) => HEADING.test(line);
export const isListItem = (/** @type {string} */ line) => LIST_ITEM.test(line);
export const startsUnit = (/** @type {string} */ line) =>
  !line.trim() || isFence(line) || isHeading(line) || isListItem(line);

/**
 * A line's prose, without its list or heading mark or the stop of a bold label that leads its
 * text, and with each code span as one word.
 * @param {string} line
 */
export const readProse = (line) =>
  line
    .replace(LEADING_MARK, "")
    .replace(BOLD_LABEL_STOP, "$1")
    .replaceAll(/`[^`]*`/g, "Code");

/** @param {string} piece */
export const countWords = (piece) => piece.split(/\s+/).filter(Boolean).length;
