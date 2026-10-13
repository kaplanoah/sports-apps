// What a search's words mean. Each phrase a search knows, from the calendar, the page, or a league,
// is matched longest first, and a word can mean more than one thing, like "New York", a team on its
// own and a place after "in", which the search decides from the words around it. A possessive or a
// plural reads as its word, and one wrong letter in a longer name, or in the start of one still being
// typed, is forgiven. Runs in the page and in Node, so it uses no DOM.

/**
 * What a phrase means, and how a suggestion writes it: by the name of what it means, or, for a
 * phrase that doesn't start with that name, as written, like "LA Dodgers".
 * @typedef {{ kind: string, value?: any, display?: string, written?: string }} Meaning
 */
/**
 * A phrase of a search, its words as typed and as read, and what it can mean, or no meanings for a
 * word the search doesn't know.
 * @typedef {{ text: string, words: string[], meanings: Meaning[] }} Token
 */
/** @typedef {Map<string, Meaning[]>} Dictionary */

const LONGEST_PHRASE = 4;
// Names this long or longer forgive one wrong letter: a short one would match too much.
export const FORGIVING_LENGTH = 5;
const FORGIVEN_KINDS = new Set(["team", "place", "month", "weekday", "round"]);

/**
 * A search's words in lowercase, without accents or punctuation but for what reads as part of a date
 * or a time, with "@" apart from what's around it. A dash between numbers, or one with spaces around
 * it, reads as "to", and one inside a word, as in "All-Star" or "mid-June", as a space.
 * @param {string} text
 */
export function normalizeText(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]s\b/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 - $2")
    .replace(/([a-z])-([a-z])/g, "$1 $2")
    .replace(/\s-\s|^-\s|\s-$/g, " - ")
    .replace(/@/g, " @ ")
    .replace(/[^a-z0-9@/:\- ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** @param {string} text */
export const splitWords = (text) => normalizeText(text).split(" ").filter(Boolean);

/**
 * A dictionary of every phrase's meanings, a phrase that means several things keeping each.
 * @param {{ phrase: string, meaning: Meaning }[]} entries
 * @returns {Dictionary}
 */
export function createDictionary(entries) {
  /** @type {Dictionary} */
  const dictionary = new Map();
  for (const { phrase, meaning } of entries) {
    const key = splitWords(phrase).join(" ");
    dictionary.set(key, [...(dictionary.get(key) ?? []), meaning]);
  }
  return dictionary;
}

/**
 * Whether two words differ by one letter added, dropped, changed, or two side by side swapped.
 * @param {string} first
 * @param {string} second
 */
export function isOneEditApart(first, second) {
  if (first === second || Math.abs(first.length - second.length) > 1) return false;
  let start = 0;
  while (start < first.length && first[start] === second[start]) start += 1;
  const isSwap =
    first.length === second.length &&
    first[start] === second[start + 1] &&
    first[start + 1] === second[start] &&
    first.slice(start + 2) === second.slice(start + 2);
  const rest = (/** @type {string} */ word, /** @type {number} */ skip) => word.slice(start + skip);
  return (
    isSwap ||
    rest(first, 1) === rest(second, 1) ||
    rest(first, 1) === rest(second, 0) ||
    rest(first, 0) === rest(second, 1)
  );
}

/**
 * Whether a typed word is a name with one wrong letter, which only a word long enough is forgiven.
 * @param {string} word
 * @param {string} name
 */
export const isForgivenTypo = (word, name) =>
  word.length >= FORGIVING_LENGTH && isOneEditApart(word, name);

/**
 * The meanings of a name one letter away from a word, when only one name is.
 * @param {string} word
 * @param {Dictionary} dictionary
 */
function findForgivenMeanings(word, dictionary) {
  if (word.length < FORGIVING_LENGTH) return [];
  const near = [...dictionary].filter(
    ([phrase, meanings]) =>
      !phrase.includes(" ") &&
      meanings.some((meaning) => FORGIVEN_KINDS.has(meaning.kind)) &&
      isForgivenTypo(word, phrase),
  );
  return near.length === 1 ? near[0][1] : [];
}

/**
 * The starts of a name a word half typed is one letter off, when it isn't how the name starts and
 * is long enough to forgive.
 * @param {string} word
 * @param {string} name
 */
function listForgivenStarts(word, name) {
  if (word.length < FORGIVING_LENGTH || name.startsWith(word)) return [];
  const starts = [-1, 0, 1].map((extra) => name.slice(0, word.length + extra));
  return starts.filter((start) => isOneEditApart(word, start));
}

/**
 * The phrases a word still being typed starts with one letter wrong, each with its meanings, when
 * one start of them all is what it means, as "nation" is for "mation" in Nationals and National
 * League, rather than two, as "bosto" and "housto" are for "hosto", and the word is one of its own
 * that doesn't already read as one the search knows.
 * @param {string} word
 * @param {Dictionary} dictionary
 * @returns {[string, Meaning[]][]}
 */
export function findForgivenStarts(word, dictionary) {
  if (word.includes(" ") || findWordMeanings(word, dictionary).length) return [];
  const near = [...dictionary].flatMap(([phrase, meanings]) => {
    const isForgivenKind = meanings.some((meaning) => FORGIVEN_KINDS.has(meaning.kind));
    const starts = isForgivenKind ? listForgivenStarts(word, phrase) : [];
    return starts.length
      ? [{ entry: /** @type {[string, Meaning[]]} */ ([phrase, meanings]), starts }]
      : [];
  });
  const [first, ...others] = near;
  const isOneStart = first?.starts.some((start) =>
    others.every((each) => each.starts.includes(start)),
  );
  return isOneStart ? near.map(({ entry }) => entry) : [];
}

/**
 * What a single word means: as written, as a plural's single, or as a name one letter off.
 * @param {string} word
 * @param {Dictionary} dictionary
 */
function findWordMeanings(word, dictionary) {
  const meanings = dictionary.get(word);
  if (meanings) return meanings;
  const single = word.endsWith("s") ? dictionary.get(word.slice(0, -1)) : undefined;
  return single ?? findForgivenMeanings(word, dictionary);
}

/**
 * The longest phrase the dictionary knows at a word, or the word alone.
 * @param {string[]} words
 * @param {number} start
 * @param {Dictionary} dictionary
 * @returns {{ length: number, meanings: Meaning[] }}
 */
function matchPhrase(words, start, dictionary) {
  for (let length = Math.min(LONGEST_PHRASE, words.length - start); length > 1; length -= 1) {
    const meanings = dictionary.get(words.slice(start, start + length).join(" "));
    if (meanings) return { length, meanings };
  }
  return { length: 1, meanings: findWordMeanings(words[start], dictionary) };
}

/**
 * A search's phrases, in order, each with what it can mean.
 * @param {string} text
 * @param {Dictionary} dictionary
 * @returns {Token[]}
 */
export function readTokens(text, dictionary) {
  const words = splitWords(text);
  const tokens = [];
  for (let start = 0; start < words.length; ) {
    const { length, meanings } = matchPhrase(words, start, dictionary);
    const phrase = words.slice(start, start + length);
    tokens.push({ text: phrase.join(" "), words: phrase, meanings });
    start += length;
  }
  return tokens;
}
