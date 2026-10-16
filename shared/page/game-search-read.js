// Reading a search's words into what it asks of a game. Each phrase is read by the reader for what
// it means where it stands, which may take the words after it too, as "June" takes "12 to 15", and
// a word no reader can use is kept as skipped, for the line to name. Runs in the page and in Node,
// so it uses no DOM.

import { addDays } from "./days.js";
import { capitalize, joinNames } from "./html.js";
import {
  RANGE_TIMES,
  createRange,
  findWeekday,
  readClockRange,
  readClockWord,
  readCountedDays,
  readMonthDay,
  readMonthDays,
  readNamedRange,
  readPartOfMonth,
  readTimeOfDay,
} from "./search-dates.js";
import { hasKind, readTokens } from "./search-words.js";

/** @typedef {import("./search-words.js").Meaning} Meaning */
/** @typedef {import("./search-words.js").Token} Token */
/** @typedef {import("./game-search.js").SearchContext} SearchContext */
/** @typedef {import("./game-search.js").Search} Search */

// When a phrase can mean several things, the word before it decides: after "in", a place or a date
// comes before a team, as in "Dream in New York", and otherwise a team comes first. A phrase that
// names more than one team and a place, as MLB's "New York" does, reads as the place.
const PREFERRED_AFTER = {
  in: ["place", "month", "range", "weekday", "team"],
  at: ["team", "place", "side"],
  none: ["team", "starter", "group", "place", "month", "range", "weekday"],
};

/** @returns {Search} */
const createEmptySearch = () => ({
  teams: [],
  starters: [],
  group: null,
  isCrossConference: false,
  side: null,
  places: [],
  ranges: [],
  weekdays: null,
  times: [],
  kinds: [],
  rounds: [],
  gameNumber: null,
  isIfNeeded: false,
  isDoubleheader: false,
  states: [],
  outcome: null,
  pick: null,
  landmark: null,
  channels: [],
  isPastRegulation: false,
  skipped: [],
});

/**
 * Whether a meaning is a place teams are from, like a city or a state, rather than an arena.
 * @param {Meaning} meaning
 */
export const isTownMeaning = (meaning) => meaning.kind === "place" && !meaning.value.isArena;

/**
 * The meaning a phrase has where it is, from the word before it. A city reads as the place, the
 * games played there, rather than as the teams that play there, which are its other readings; an
 * arena named for its team, like "Nationals", reads as the team.
 * @param {Meaning[]} meanings
 * @param {string | null} before "in", "at", or null
 */
function chooseMeaning(meanings, before) {
  if (meanings.length < 2) return meanings[0] ?? null;
  const town = meanings.find(isTownMeaning);
  if (town && meanings.some((meaning) => meaning.kind === "team")) return town;
  const order = PREFERRED_AFTER[before ?? "none"] ?? PREFERRED_AFTER.none;
  const rank = (/** @type {Meaning} */ meaning) => {
    const index = order.indexOf(meaning.kind);
    return index < 0 ? order.length : index;
  };
  return [...meanings].sort((first, second) => rank(first) - rank(second))[0];
}

/** @param {Token | undefined} token */
const readNumber = (token) =>
  token && /^\d{1,2}(st|nd|rd|th)?$/.test(token.text) ? Number.parseInt(token.text, 10) : null;

/**
 * @param {Token | undefined} token
 * @param {string} kind
 */
const findKind = (token, kind) => token?.meanings.find((meaning) => meaning.kind === kind);

/**
 * The year a month of the season falls in: the year the season starts, or, for a season that runs
 * into the next year, the next one for a month before the one it starts in.
 * @param {SearchContext} context
 * @param {number} month 1 to 12
 */
function readSeasonMonthYear({ seasonStart, seasonEnd }, month) {
  const startYear = Number(seasonStart.slice(0, 4));
  const runsIntoNextYear = Number(seasonEnd.slice(0, 4)) > startYear;
  return runsIntoNextYear && month < Number(seasonStart.slice(5, 7)) ? startYear + 1 : startYear;
}

/**
 * The days of a month of the season.
 * @param {SearchContext} context
 * @param {number} month 1 to 12
 */
const readSeasonMonthDays = (context, month) =>
  readMonthDays(month, readSeasonMonthYear(context, month));

/**
 * A day of a month of the season, as "YYYY-MM-DD", or null for one the calendar doesn't have.
 * @param {SearchContext} context
 * @param {number} month 1 to 12
 * @param {number} day
 */
const readSeasonDay = (context, month, day) =>
  readMonthDay(month, day, readSeasonMonthYear(context, month));

// Each reader takes the tokens from where it stands and says how many it used, or 0 when the words
// there aren't its own.
/**
 * @typedef {object} ReadState
 * @property {Token[]} tokens
 * @property {number} at
 * @property {Search} search
 * @property {SearchContext} context
 * @property {string | null} join the joining word waiting for the team after it
 * @property {string | null} before "in", "at", or "on", waiting for what comes next
 */

/**
 * Keeps the tokens from where a reader stands as words the search couldn't use, as a date the
 * calendar doesn't have, and says how many they were.
 * @param {ReadState} state
 * @param {number} count
 */
function skipTokens({ tokens, at, search }, count) {
  const skipped = tokens.slice(at, at + count).map((token) => token.text);
  search.skipped.push(skipped.join(" "));
  return count;
}

/**
 * The days from one day to another, unless either is one the calendar doesn't have, which skips
 * the tokens that named them.
 * @param {ReadState} state
 * @param {string | null} from
 * @param {string | null} to
 * @param {number} count the tokens that named them
 */
function readDaysAt(state, from, to, count) {
  if (!from || !to) return skipTokens(state, count);
  state.search.ranges.push(createRange(from, to));
  return count;
}

/**
 * A month, a day of one, or days of one: "June", "June 12", "June 12th", "June 12 to 15", or
 * "June 12 - July 2".
 * @param {ReadState} state
 * @param {number} month
 */
function readMonthAt(state, month) {
  const { tokens, at, context, search } = state;
  const day = readNumber(tokens[at + 1]);
  if (day === null) {
    search.ranges.push(readSeasonMonthDays(context, month));
    return 1;
  }
  const from = readSeasonDay(context, month, day);
  const toMonth = findKind(tokens[at + 3], "month")?.value;
  const endOffset = toMonth ? 4 : 3;
  const endDay = hasKind(tokens[at + 2], "to") ? readNumber(tokens[at + endOffset]) : null;
  if (endDay === null) return readDaysAt(state, from, from, 2);
  return readDaysAt(state, from, readSeasonDay(context, toMonth ?? month, endDay), endOffset + 1);
}

/**
 * A day by its month and day, as "6/20", by its day and then its month, as "20 June", or by its
 * day of this month, as "20th", or else a clock time.
 * @param {ReadState} state
 */
function readNumberAt(state) {
  const { tokens, at, context } = state;
  const token = tokens[at];
  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(token.text);
  if (slash) {
    const day = readSeasonDay(context, Number(slash[1]), Number(slash[2]));
    return readDaysAt(state, day, day, 1);
  }
  const number = readNumber(token);
  const month = findKind(tokens[at + 1], "month")?.value;
  if (number !== null && month) {
    const day = readSeasonDay(context, month, number);
    return readDaysAt(state, day, day, 2);
  }
  if (number !== null && /(st|nd|rd|th)$/.test(token.text)) {
    const day = readSeasonDay(context, Number(context.today.slice(5, 7)), number);
    return readDaysAt(state, day, day, 1);
  }
  return readClockAt(state, "at");
}

/**
 * A clock time, with the side of it a game starts on: "after 9", "before 7 pm", or "at 7:30".
 * @param {ReadState} state
 * @param {"after" | "before" | "at"} side
 */
function readClockAt(state, side) {
  const { tokens, at, search } = state;
  const meridiem = findKind(tokens[at + 1], "meridiem")?.value;
  const minutes = readClockWord(tokens[at]?.text ?? "", meridiem);
  if (minutes === null) return 0;
  search.times.push(readClockRange(side, minutes));
  return meridiem ? 2 : 1;
}

/**
 * A count of days ahead or gone by after the word before it, as "next 7 days" or "last 10 days".
 * @param {ReadState} state
 * @param {"next" | "last"} which
 */
function readCountedDaysAt(state, which) {
  const { tokens, at, context, search } = state;
  const count = readNumber(tokens[at + 1]);
  if (count === null || !/^days?$/.test(tokens[at + 2]?.text ?? "")) return 0;
  search.ranges.push(readCountedDays(count, context.today, which));
  return 3;
}

/**
 * "Next" or "last", with how many: "next game", "last 5", or the days ahead or gone by, "next 7
 * days" or "last 10 days". Before a weekday, it picks the day, as "last Saturday" does.
 * @param {ReadState} state
 * @param {"next" | "last"} which
 */
function readPickAt(state, which) {
  const { tokens, at, context, search } = state;
  const weekday = findKind(tokens[at + 1], "weekday")?.value;
  if (weekday !== undefined) {
    const day = findWeekday(
      weekday,
      which === "last" ? context.today : addDays(context.today, 1),
      which,
    );
    search.ranges.push(createRange(day, day));
    return 2;
  }
  const days = readCountedDaysAt(state, which);
  if (days) return days;
  const count = readNumber(tokens[at + 1]);
  search.pick = { which, count: count ?? 1 };
  return count === null ? 1 : 2;
}

/**
 * A game's state, as "live" or "results", or, for a word for games gone by before a count of days,
 * as "past 10 days", those days.
 * @param {ReadState} state
 * @param {Meaning} meaning
 */
function readStateAt(state, meaning) {
  const days = meaning.value === "final" ? readCountedDaysAt(state, "last") : 0;
  if (days) return days;
  state.search.states.push(meaning.value);
  return 1;
}

/**
 * "Before" or "after" a clock time, or the All-Star break.
 * @param {ReadState} state
 * @param {"before" | "after"} side
 */
function readSideOfAt(state, side) {
  const { tokens, at, search } = state;
  const breakAt = tokens.findIndex(
    (token, index) =>
      index > at && !hasKind(token, "filler") && findKind(token, "kind")?.value !== "all-star",
  );
  if (findKind(tokens[breakAt], "landmark")?.value === "break") {
    search.landmark = {
      name: `${side}-break`,
      label: `${side === "before" ? "Before" : "After"} the All-Star break`,
    };
    return breakAt - at + 1;
  }
  const next = tokens[at + 1];
  const used = next ? readClockAt({ ...state, at: at + 1 }, side) : 0;
  return used ? used + 1 : 0;
}

/**
 * "Early", "mid", or "late" in a month, or, for "late", late games.
 * @param {ReadState} state
 * @param {string} part
 */
function readPartAt(state, part) {
  const { tokens, at, context, search } = state;
  const month = findKind(tokens[at + 1], "month")?.value;
  if (month) {
    search.ranges.push(readPartOfMonth(part, month, readSeasonMonthYear(context, month)));
    return 2;
  }
  if (part !== "late") return 0;
  search.times.push(readTimeOfDay("late"));
  return 1;
}

/**
 * "Game 3", a game of a series.
 * @param {ReadState} state
 */
function readGameNumberAt(state) {
  const number = readNumber(state.tokens[state.at + 1]);
  if (number === null) return 1;
  state.search.gameNumber = number;
  return 2;
}

/**
 * The values of every meaning of one kind the token where a reader stands has, as "Sox" names two
 * teams.
 * @param {ReadState} state
 * @param {string} kind
 */
const listValuesAt = (state, kind) =>
  state.tokens[state.at].meanings
    .filter((meaning) => meaning.kind === kind)
    .map((meaning) => meaning.value);

/**
 * The starters a name names, by the names they go by.
 * @param {ReadState} state
 */
function readStartersAt(state) {
  const names = state.tokens[state.at].meanings
    .filter((meaning) => meaning.kind === "starter")
    .map((meaning) => /** @type {string} */ (meaning.display));
  return { ids: listValuesAt(state, "starter"), name: joinNames([...new Set(names)], "or") };
}

/**
 * The season's first or last game, by the league's words for its opener, or the All-Star break.
 * @param {ReadState} state
 * @param {Meaning} meaning
 */
function readLandmarkAt({ search, context }, meaning) {
  const labels = {
    opener: capitalize(context.terms.words.seasonOpener),
    finale: "Season finale",
    break: "All-Star break",
  };
  search.landmark = { name: meaning.value, label: labels[meaning.value] };
  return 1;
}

/**
 * What each kind of meaning asks of a game, from where it stands, and how many tokens it used.
 * @type {Record<string, (state: ReadState, meaning: Meaning) => number>}
 */
const READERS = {
  filler: () => 1,
  to: () => 1,
  game: (state) => readGameNumberAt(state),
  join: (state, meaning) => {
    state.join = meaning.value;
    if (meaning.value === "at") state.before = "at";
    return 1;
  },
  in: (state) => ((state.before = "in"), 1),
  on: (state) => ((state.before = "on"), 1),
  team: (state) => {
    state.search.teams.push({ codes: listValuesAt(state, "team"), join: state.join });
    state.join = null;
    return 1;
  },
  starter: (state) => (state.search.starters.push(readStartersAt(state)), 1),
  group: ({ search }, meaning) => ((search.group = meaning.value), 1),
  cross: ({ search }) => ((search.isCrossConference = true), 1),
  place: ({ search }, meaning) => (search.places.push(meaning.value), 1),
  side: ({ search }, meaning) => ((search.side = meaning.value), 1),
  month: (state, meaning) => readMonthAt(state, meaning.value),
  weekday: ({ search, context }, meaning) => {
    const day = findWeekday(meaning.value, context.today);
    search.ranges.push(createRange(day, day));
    return 1;
  },
  weekdays: ({ search }, meaning) => (
    (search.weekdays = { value: meaning.value, label: meaning.display }),
    1
  ),
  range: ({ search, context }, meaning) => {
    search.ranges.push(readNamedRange(meaning.value, context));
    if (RANGE_TIMES[meaning.value]) search.times.push(readTimeOfDay(RANGE_TIMES[meaning.value]));
    return 1;
  },
  time: ({ search }, meaning) => (search.times.push(readTimeOfDay(meaning.value)), 1),
  "part-of-month": (state, meaning) => readPartAt(state, meaning.value),
  after: (state) => readSideOfAt(state, "after"),
  before: (state) => readSideOfAt(state, "before"),
  pick: (state, meaning) => readPickAt(state, meaning.value),
  state: readStateAt,
  kind: ({ search }, meaning) => (search.kinds.push(meaning.value), 1),
  round: ({ search }, meaning) => (search.rounds.push(meaning.value), 1),
  "if-needed": ({ search }) => ((search.isIfNeeded = true), 1),
  doubleheader: ({ search }) => ((search.isDoubleheader = true), 1),
  outcome: ({ search }, meaning) => ((search.outcome = meaning.value), 1),
  channel: (state) => (state.search.channels.push(...listValuesAt(state, "channel")), 1),
  "past-regulation": ({ search }) => ((search.isPastRegulation = true), 1),
  landmark: readLandmarkAt,
};

/**
 * Reads a search's words into what it asks of a game.
 * @param {string} text
 * @param {SearchContext} context
 * @returns {Search}
 */
export function readSearch(text, context) {
  const tokens = readTokens(text, context.dictionary);
  /** @type {ReadState} */
  const state = { tokens, at: 0, search: createEmptySearch(), context, join: null, before: null };
  while (state.at < tokens.length) {
    const token = tokens[state.at];
    const meaning = chooseMeaning(token.meanings, state.before);
    const before = state.before;
    const used = meaning ? (READERS[meaning.kind]?.(state, meaning) ?? 0) : readNumberAt(state);
    if (state.before === before && meaning?.kind !== "filler") state.before = null;
    if (!used) state.search.skipped.push(token.text);
    state.at += Math.max(used, 1);
  }
  return state.search;
}

/**
 * Whether a search asks for nothing a game has, as one of only words it passes over, like "a",
 * does.
 * @param {Search} search
 */
export const isAskingNothing = (search) =>
  JSON.stringify({ ...search, skipped: [] }) === JSON.stringify(createEmptySearch());

/**
 * Whether a search could use none of its words, as one about players' stats can't, so it asks for
 * nothing a game has.
 * @param {Search} search
 */
export const isUnread = (search) => search.skipped.length > 0 && isAskingNothing(search);
