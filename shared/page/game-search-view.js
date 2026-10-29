// A search over a season's games, and the league's teams and players and its other pages too: a
// field with Cancel, then what the words find. Before anything is
// typed, quiet examples to tap sit under the field, inside its width. While words are typed,
// suggestions sit over the pages the words name, like a team's sheet, or under the players a
// team's number names, then a line saying how the search read the words, right over the games it
// found from today on, which a tap on the line opens whole. A search sent shows the same without the suggestions, or, when its words ask only for
// games, the games at once, the line under the field and the list opening on the first from today,
// as does a tap on the line. A tap on the field goes back to what typing showed. A reload shows the
// search as it was, and two minutes away closes it. A league hands it its season's games and words,
// how it draws a day's games, a team's dot, its pages and how it opens them, and what the search
// does as it closes.

import { describeDay, readCalendarDate } from "./days.js";
import { createSearchContext, createSearchDictionary, describeNoGames } from "./game-search.js";
import { markBarStuck } from "./held-bar.js";
import { html, isWebAddress, joinWithSeparator, setHtml } from "./html.js";
import { chooseDayMarkup, hasStandIns, listDaysAround, measureNearDays } from "./near-days.js";
import { nameStoryDay } from "./news-view.js";
import { openPageTab, readShownTab, readTabBefore, setTabEnter, setTabStart } from "./page-tabs.js";
import { runAfterPress } from "./press.js";
import { watchTimeAway } from "./resume.js";
import {
  findListPlace,
  listShownExamples,
  orderListedDays,
  readSentWords,
  readTypedSearch,
} from "./search-reading.js";

/* global isAwayLong -- from long-away.js */

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {import("./game-search.js").SearchGame} SearchGame */
/** @typedef {import("./game-search.js").SearchTerms} SearchTerms */
/** @typedef {import("./search-suggestions.js").Suggestion} Suggestion */
/** @typedef {import("./page-search.js").SearchPages} SearchPages */
/** @typedef {import("./page-search.js").PageRow} PageRow */
/** @typedef {import("./page-search.js").GamePart} GamePart */
/** @typedef {import("./day-strip.js").ListedDay} ListedDay */
/** @typedef {import("./search-reading.js").ShownRow} ShownRow */
/** @typedef {ReturnType<typeof findListPlace>} ListPlace */
/**
 * What a league hands its search.
 * @typedef {object} SearchLeague
 * @property {() => { terms: SearchTerms, games: SearchGame[] } | null} readSeason the season shown,
 *   or null before the page has one
 * @property {(games: SearchGame[], now: number) => ListedDay[]} listDays the days of the games
 *   found, drawn as the Games view draws them, with a stand-in for each when it has them
 * @property {(code: string) => Markup} renderTeamMark a team's dot
 * @property {() => SearchPages} readPages the teams, players, and places a search can open
 * @property {string} placeholder what the empty field says
 * @property {(key: string) => void} openPlace opens a place a search lists, by its key
 */

// Phosphor's magnifying-glass at its Light weight in the field, as the page's controls are, and at
// its Regular weight, calendar-blank, and map-pin beside a suggestion's words, trophy, trend-up,
// newspaper, and sliders-horizontal beside a place's, as the tabs and the settings button show them,
// film-strip beside a final's Highlights, and baseball beside a game's Matchup.
const FIELD_GLASS = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M228.24,219.76l-51.38-51.38a86.15,86.15,0,1,0-8.48,8.48l51.38,51.38a6,6,0,0,0,8.48-8.48ZM38,112a74,74,0,1,1,74,74A74.09,74.09,0,0,1,38,112Z"/></svg>`;
const MARKS = {
  search: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>`,
  date: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Z"/></svg>`,
  place: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,64a40,40,0,1,0,40,40A40,40,0,0,0,128,64Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,128Zm0-112a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,206c-16.53-13-72-60.75-72-118a72,72,0,0,1,144,0C200,161.23,144.53,209,128,222Z"/></svg>`,
  bracket: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M232,64H208V48a8,8,0,0,0-8-8H56a8,8,0,0,0-8,8V64H24A16,16,0,0,0,8,80V96a40,40,0,0,0,40,40h3.65A80.13,80.13,0,0,0,120,191.61V216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V191.58c31.94-3.23,58.44-25.64,68.08-55.58H208a40,40,0,0,0,40-40V80A16,16,0,0,0,232,64ZM48,120A24,24,0,0,1,24,96V80H48v32q0,4,.39,8Zm144-8.9c0,35.52-29,64.64-64,64.9a64,64,0,0,1-64-64V56H192ZM232,96a24,24,0,0,1-24,24h-.5a81.81,81.81,0,0,0,.5-8.9V80h24Z"/></svg>`,
  standings: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M240,56v64a8,8,0,0,1-16,0V75.31l-82.34,82.35a8,8,0,0,1-11.32,0L96,123.31,29.66,189.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0L136,140.69,212.69,64H168a8,8,0,0,1,0-16h64A8,8,0,0,1,240,56Z"/></svg>`,
  news: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M88,112a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H96A8,8,0,0,1,88,112Zm8,40h80a8,8,0,0,0,0-16H96a8,8,0,0,0,0,16ZM232,64V184a24,24,0,0,1-24,24H32A24,24,0,0,1,8,184.11V88a8,8,0,0,1,16,0v96a8,8,0,0,0,16,0V64A16,16,0,0,1,56,48H216A16,16,0,0,1,232,64Zm-16,0H56V184a23.84,23.84,0,0,1-1.37,8H208a8,8,0,0,0,8-8Z"/></svg>`,
  settings: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M40,88H73a32,32,0,0,0,62,0h81a8,8,0,0,0,0-16H135a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16Zm64-24A16,16,0,1,1,88,80,16,16,0,0,1,104,64ZM216,168H199a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16h97a32,32,0,0,0,62,0h17a8,8,0,0,0,0-16Zm-48,24a16,16,0,1,1,16-16A16,16,0,0,1,168,192Z"/></svg>`,
  matchup: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM72.09,195.91c.82-1,1.64-1.93,2.42-2.91A8,8,0,1,0,62,183l-1.34,1.62a87.82,87.82,0,0,1,0-113.24L62,73A8,8,0,1,0,74.51,63c-.78-1-1.6-2-2.42-2.91a87.84,87.84,0,0,1,111.82,0c-.82,1-1.64,1.92-2.42,2.91A8,8,0,1,0,194,73l1.34-1.62a87.82,87.82,0,0,1,0,113.24L194,183a8,8,0,1,0-12.48,10c.78,1,1.6,1.95,2.42,2.91a87.84,87.84,0,0,1-111.82,0Zm23.8-50.59a104.5,104.5,0,0,1-4.48,17.35,8,8,0,0,1-15.09-5.34,87.1,87.1,0,0,0,3.79-14.65,8,8,0,1,1,15.78,2.64Zm0-34.64a8,8,0,0,1-6.57,9.21A8.52,8.52,0,0,1,88,120a8,8,0,0,1-7.88-6.68,87.1,87.1,0,0,0-3.79-14.65,8,8,0,0,1,15.09-5.34A104.5,104.5,0,0,1,95.89,110.68Zm78.91,56.86a8,8,0,0,1-10.21-4.87,104.5,104.5,0,0,1-4.48-17.35,8,8,0,1,1,15.78-2.64,87.1,87.1,0,0,0,3.79,14.65A8,8,0,0,1,174.8,167.54Zm-14.69-56.86a104.5,104.5,0,0,1,4.48-17.35,8,8,0,0,1,15.09,5.34,87.1,87.1,0,0,0-3.79,14.65A8,8,0,0,1,168,120a8.52,8.52,0,0,1-1.33-.11A8,8,0,0,1,160.11,110.68Z"/></svg>`,
  highlights: html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM40,88h80v80H40Zm96-16V56h32V72Zm-16,0H88V56h32Zm0,112v16H88V184Zm16,0h32v16H136Zm0-16V88h80v80Zm80-96H184V56h32ZM72,56V72H40V56ZM40,184H72v16H40Zm176,16H184V184h32v16Z"/></svg>`,
};
// Phosphor's caret-right at its Regular weight, at the end of a row that opens a page, and after
// each place a place's row names it in, as a breadcrumb.
const CARET = html`<svg class="search-caret" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>`;
const CRUMB = html`<svg class="search-crumb" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>`;
// Phosphor's x-circle at its Fill weight, to clear the field, as iOS does.
const CLEAR = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>`;

/** @type {HTMLElement | null} */
let view = null;
/** @type {SearchLeague | null} */
let league = null;
// While words are typed, suggestions show over the games, until a suggestion is tapped or the
// search is sent.
let isTyping = false;
// After a tap on the line over the games, the games show whole, until the field is tapped.
let isGamesOnly = false;
/**
 * What the list shows, for placing it once for each: the search, and whether rows sit over its
 * games.
 * @typedef {{ text: string, isOverGames: boolean }} Shown
 */
// What the list was last placed for, so a redraw keeps where it is.
/** @type {Shown | null} */
let placedFor = null;
// The days of the games the list draws, and those near the screen, which it draws whole.
/** @type {ListedDay[]} */
let listedDays = [];
/** @type {Set<string>} */
let nearDays = new Set();
let isNearFramePending = false;
/** @type {WeakMap<SearchTerms, import("./search-words.js").Dictionary>} */
const dictionaries = new WeakMap();

const findInput = () =>
  /** @type {HTMLInputElement | null} */ (view?.querySelector(".search-input") ?? null);
const findBar = () =>
  /** @type {HTMLElement | null} */ (view?.querySelector(".search-bar") ?? null);
const findList = () =>
  /** @type {HTMLElement | null} */ (view?.querySelector(".search-list") ?? null);
const findRead = () =>
  /** @type {HTMLElement | null} */ (view?.querySelector(".search-read") ?? null);

/**
 * The field's glass and words share a label, so a tap on the glass reaches the field, beside its
 * Clear button, which a label can't hold.
 */
export const renderSearchShell = () =>
  html`<div class="day-bar search-bar is-empty">
      <form class="search-row" role="search">
        <div class="search-field">
          <label class="search-label"
            >${FIELD_GLASS}<input
              type="search"
              class="search-input"
              value=""
              enterkeyhint="search"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
          /></label>
          <button type="button" class="search-clear" aria-label="Clear" hidden>${CLEAR}</button>
        </div>
        <button type="button" class="search-cancel">Cancel</button>
      </form>
      <p class="search-read" role="status"></p>
    </div>
    <div class="day-list search-list"></div>`;

/**
 * Whether the view holds this release's shell, rather than none or one put back from an earlier
 * release, whose label held Clear.
 */
const hasCurrentShell = () => !!view?.querySelector(".search-label .search-input");

/** The words in the field, as typed. */
const readQuery = () => findInput()?.value ?? "";

/**
 * Puts words in the field, and in its markup, so a reload shows them.
 * @param {string} text
 */
function writeQuery(text) {
  const input = findInput();
  if (!input) return;
  input.value = text;
  input.setAttribute("value", text);
  const clear = /** @type {HTMLElement | null} */ (view?.querySelector(".search-clear") ?? null);
  if (clear) clear.hidden = !text;
}

/** @param {{ terms: SearchTerms, games: SearchGame[] }} season */
function createContext({ terms, games }) {
  if (!dictionaries.has(terms)) dictionaries.set(terms, createSearchDictionary(terms));
  const dictionary = /** @type {import("./search-words.js").Dictionary} */ (
    dictionaries.get(terms)
  );
  return createSearchContext({ terms, dictionary, games, now: Date.now() });
}

/**
 * The examples to tap, inside the field's width, as room as wide as Cancel keeps them from it.
 * @param {string[]} examples
 */
const renderExamples = (examples) =>
  html`<div class="search-examples">
    <ul>
      ${examples.map(
        (example) =>
          html`<li><button type="button" class="search-example press-tint" data-search="${example}">${example}</button></li>`,
      )}
    </ul>
    <span class="search-cancel search-cancel-room" aria-hidden="true">Cancel</span>
  </div>`;

/**
 * A suggestion's words, with the part already typed dimmer.
 * @param {string} text
 * @param {string} typed
 */
function renderTyped(text, typed) {
  let length = 0;
  while (length < typed.length && text[length]?.toLowerCase() === typed[length].toLowerCase())
    length += 1;
  return html`<span class="search-typed">${text.slice(0, length)}</span>${text.slice(length)}`;
}

/** @param {Suggestion["mark"]} mark */
const renderMark = (mark) =>
  mark.kind === "team" ? league?.renderTeamMark(mark.code) : MARKS[mark.kind];

/**
 * Rows that each run a search: a suggestion, with the part already typed dimmer, or another way to
 * read the words.
 * @param {Suggestion[]} suggestions
 * @param {string} typed
 */
const renderSuggestions = (suggestions, typed) =>
  html`<ul class="search-suggestions">
    ${suggestions.map(
      ({ text, mark, detail }) =>
        html`<li>
          <button type="button" class="search-suggestion press-tint" data-search="${text}">
            <span class="search-mark">${renderMark(mark)}</span
            ><span class="search-words">${renderTyped(text, typed)}</span
            >${detail && html`<span class="search-detail">${detail}</span>`}
          </button>
        </li>`,
    )}
  </ul>`;

/**
 * A game's teams and day, as "Lynx at Liberty" on "Yesterday".
 * @param {SearchGame} game
 * @param {import("./game-search.js").SearchContext} context
 */
const describeGame = (game, context) =>
  joinWithSeparator([
    [game.away, game.home].map((code) => context.teamsByCode.get(code ?? "")?.name).join(" at "),
    describeDay(readCalendarDate(game.day), Date.now()),
  ]);

/**
 * A place's name, after the places it's in, each dimmed and followed by a caret, as Settings, then
 * Appearance.
 * @param {string[]} name
 */
const renderPlaceName = (name) =>
  html`${name.slice(0, -1).map((part) => html`<span class="search-place-in">${part}</span>${CRUMB}`)}${name.at(-1)}`;

/**
 * What a page's row says, and what it says at its end.
 * @param {ShownRow} row
 * @param {SearchPages} pages
 * @param {import("./game-search.js").SearchContext} context
 */
function describePageRow(row, pages, context) {
  if (row.kind === "place")
    return { words: renderPlaceName(row.place.name), detail: row.detail ?? "" };
  if (row.kind === "story")
    return {
      words: row.story.title,
      detail: joinWithSeparator([
        row.story.outlet,
        nameStoryDay(row.story.publishedAt, Date.now()),
      ]),
    };
  if (row.kind === "game") return { words: row.part.name, detail: describeGame(row.game, context) };
  if (!("player" in row)) {
    if (row.kind === "team") return { words: row.team.fullName, detail: row.team.record ?? "" };
    return { words: pages.section?.name ?? "", detail: row.team.fullName };
  }
  const { player, team } = row;
  return {
    words: `${player.firstName} ${player.lastName}`,
    detail:
      row.out && player.out
        ? describeOut(player.out, row.out)
        : joinWithSeparator([player.number, team.name].filter(Boolean)),
  };
}

/**
 * Why a player is out, as her row says it: in a list of who's out, just why, like "Concussion",
 * with "Season" after it when she's out for the season, and for a player named, that she's out too.
 * @param {import("./page-search.js").PlayerOut} out
 * @param {"listed" | "named"} how
 */
const describeOut = ({ reason, isForSeason }, how) =>
  joinWithSeparator(
    [
      how === "named" && "Out",
      reason ?? (how === "listed" && "Out"),
      isForSeason && "Season",
    ].filter(Boolean),
  );

/**
 * What a page's row opens: a place or a game's part, as the league opens it, or a button the
 * team's and player's sheets open from, a player's over her team's sheet, on its section that lists
 * her.
 * @param {ShownRow} row
 * @param {SearchPages} pages
 */
function renderPageButton(row, pages) {
  if (row.kind === "place")
    return html`type="button" class="search-suggestion press-tint" data-place="${row.place.key}" aria-label="${row.place.name.join(", ")}"`;
  if (row.kind === "game")
    return html`type="button" class="search-suggestion press-tint" data-place="${row.part.key}:${row.game.id}"`;
  if (row.kind === "story") return html``;
  const section = row.kind === "team" ? "" : (pages.section?.key ?? "");
  const opens = html`type="button" class="search-suggestion press-tint team-open" data-team="${row.team.code}" data-team-section="${section}"`;
  if (!("player" in row)) return opens;
  const { player } = row;
  return html`${opens} data-player="${player.id}" data-player-team="${player.team}" data-player-name="${player.firstName} ${player.lastName}" data-player-number="${player.number}"`;
}

/**
 * A row's mark: a team's dot, or a place's or a game's part's icon.
 * @param {ShownRow} row
 */
function renderRowMark(row) {
  if (row.kind === "place") return MARKS[row.place.icon];
  if (row.kind === "story") return MARKS.news;
  if (row.kind === "game") return MARKS[row.part.key];
  return league?.renderTeamMark(row.team.code);
}

/**
 * A row that opens a page, marked with its team's dot, or a place's or a game's part's icon.
 * @param {ShownRow} row
 * @param {SearchPages} pages
 * @param {import("./game-search.js").SearchContext} context
 */
function renderPageRow(row, pages, context) {
  const { words, detail } = describePageRow(row, pages, context);
  const mark = renderRowMark(row);
  const content = html`<span class="search-mark">${mark}</span><span class="search-words" ${row.kind === "story" ? "data-quoted" : ""}
      >${words}</span
    >${detail && html`<span class="search-detail">${detail}</span>`}${CARET}`;
  if (row.kind === "story") return renderStoryRow(row.story, content);
  return html`<li>
    <button ${renderPageButton(row, pages)}>${content}</button>
  </li>`;
}

/**
 * A story's row, a link that opens it apart from the page, as the News tab's Read button does, with
 * its headline in the outlet's own words.
 * @param {import("./news-picks.js").NewsStory} story
 * @param {Markup} content
 */
const renderStoryRow = (story, content) =>
  isWebAddress(story.url)
    ? html`<li>
        <a
          class="search-suggestion press-tint"
          href="${story.url}"
          target="_blank"
          rel="noopener noreferrer"
          >${content}</a
        >
      </li>`
    : html``;

/**
 * @param {ShownRow[]} rows
 * @param {SearchPages} pages
 * @param {import("./game-search.js").SearchContext} context
 */
const renderPageRows = (rows, pages, context) =>
  html`<ul class="search-suggestions">
    ${rows.map((row) => renderPageRow(row, pages, context))}
  </ul>`;

/**
 * The line saying how the search read its words, right over the games, which a tap opens whole,
 * with the words as it read them, a half-typed team's or place's finished.
 * @param {{ lead: string, facts: string[] }} read
 * @param {string} readText
 */
const renderGamesLine = (read, readText) =>
  html`<button type="button" class="search-games-line press-tint" data-games="${readText}">
    <span class="search-games-words">${renderRead(read)}</span>${CARET}
  </button>`;

// Keyed by its date, a day keeps its own node as the list's other parts come and go around it.
/** @param {ListedDay[]} days */
const renderDays = (days) =>
  html`${days.map(
    (listed) =>
      html`<div class="listed-day" data-day="${listed.day}" data-key="${listed.day}">${chooseDayMarkup(listed, nearDays)}</div>`,
  )}`;

/** @param {string} day */
const findListedDay = (day) =>
  /** @type {HTMLElement | null} */ (
    findList()?.querySelector(`:scope > .listed-day[data-day="${day}"]`) ?? null
  );

/**
 * Keeps the days the list draws, and which of them it draws whole: those around the day a new
 * search places it on, or, while the same search shows, those it had near the screen.
 * @param {ListedDay[]} days
 * @param {string | null} startDay
 * @param {Shown} shown
 */
function keepListedDays(days, startDay, shown) {
  if (!isPlacedFor(shown)) nearDays = startDay ? listDaysAround(days, startDay) : new Set();
  listedDays = days;
}

// A day a draw of the whole list leaves as it is once written on its own (setHtml in html.js), so
// each is written on its own, whole or as a stand-in.
/** @param {ListedDay[]} days */
function writeListedDays(days) {
  for (const listed of days) {
    const element = findListedDay(listed.day);
    if (element) setHtml(element, chooseDayMarkup(listed, nearDays));
  }
}

// As the list moves, the days that came near what it shows are drawn whole, and those that left
// stand in again. A stand-in is as tall as its games, so this moves nothing.
function drawNearDays() {
  const list = findList();
  if (!list || !list.clientHeight || !hasStandIns(listedDays)) return;
  const before = nearDays;
  nearDays = measureNearDays(list, listedDays, [list.scrollTop], findListedDay);
  writeListedDays(listedDays.filter(({ day }) => before.has(day) !== nearDays.has(day)));
}

/**
 * The line under the field: what the search is about, in bold, then the rest of what it read.
 * @param {{ lead: string, facts: string[] }} read
 */
const renderRead = ({ lead, facts }) => joinWithSeparator([html`<b>${lead}</b>`, ...facts]);

/**
 * The line under the field: what an answer's rows are, or what a search of games read, or nothing.
 * @param {{ lead: string, facts: string[] } | null | undefined} read
 */
const renderReadLine = (read) => (read ? renderRead(read) : html``);

/**
 * Places the list where `findListPlace` says: on its day, with room after the last day for that
 * day to reach the top, or at its top or its end.
 * @param {ListPlace} place
 */
function placeList({ at, day }) {
  const list = findList();
  if (!list) return;
  const gap = Number.parseFloat(getComputedStyle(list).paddingTop) || 0;
  const start = at === "day" && day ? findListedDay(day) : null;
  const lastDay = listedDays.at(-1)?.day;
  const last = lastDay ? findListedDay(lastDay) : null;
  const room = start && last ? list.clientHeight - last.offsetHeight - gap : 0;
  list.style.setProperty("--end-room", `${Math.max(0, room)}px`);
  if (start) list.scrollTop = Math.max(0, start.offsetTop - gap);
  else list.scrollTop = at === "top" ? 0 : list.scrollHeight;
  markStuck();
}

const markStuck = () => markBarStuck(findBar(), findList());

// The days near the screen are drawn once a frame, however many scroll events it brings.
function followScroll() {
  markStuck();
  if (isNearFramePending) return;
  isNearFramePending = true;
  requestAnimationFrame(() => {
    isNearFramePending = false;
    drawNearDays();
  });
}

/** Draws what the search finds, or its examples while nothing is typed. */
function draw() {
  const season = league?.readSeason();
  const list = findList();
  const readLine = findRead();
  if (!season || !list || !readLine) return;
  const context = createContext(season);
  const query = readQuery();
  const text = query.trim();
  const pages = league?.readPages() ?? null;
  findBar()?.classList.toggle("is-empty", !text);
  if (!text) {
    findBar()?.classList.remove("has-rows");
    setHtml(readLine, html``);
    listedDays = [];
    setHtml(list, renderExamples(listShownExamples(context, pages)));
    placeOnce({ text: "", isOverGames: false }, findListPlace([], context.today, false));
    return;
  }
  const {
    suggestions,
    readText,
    rows,
    isRowsFirst,
    answer,
    others,
    search,
    read,
    isOverGames,
    games,
    isNewestFirst,
  } = readTypedSearch(query, { context, pages, isTyping, isGamesOnly });
  findBar()?.classList.toggle("has-rows", isOverGames);
  setHtml(readLine, renderReadLine(answer ?? (isOverGames ? null : read)));
  const shown = { text, isOverGames };
  const days = orderListedDays(
    games.length ? league.listDays(games, Date.now()) : [],
    isNewestFirst,
  );
  const place = findListPlace(days, context.today, isOverGames);
  keepListedDays(days, place.day, shown);
  if (!isOverGames) {
    const gameList = days.length
      ? renderDays(days)
      : html`<p class="empty-note">${search && describeNoGames(search, context)}</p>`;
    setHtml(list, gameList);
    showDays(shown, place);
    return;
  }
  const suggestionList = suggestions.length > 0 && renderSuggestions(suggestions, query);
  const rowList = pages && rows.length > 0 && renderPageRows(rows, pages, context);
  setHtml(
    list,
    html`${isRowsFirst ? html`${rowList}${suggestionList}` : html`${suggestionList}${rowList}`}${
      others.length > 0 && renderSuggestions(others, "")
    }${read && days.length > 0 && html`${renderGamesLine(read, readText)}${renderDays(days)}`}`,
  );
  showDays(shown, place);
}

/**
 * Brings each day the list draws up to date, places a new search, and draws whole the days it put
 * near the screen.
 * @param {Shown} shown
 * @param {ListPlace} place
 */
function showDays(shown, place) {
  writeListedDays(listedDays);
  placeOnce(shown, place);
  drawNearDays();
}

/**
 * Whether the list was last placed for what it shows.
 * @param {Shown} shown
 */
const isPlacedFor = (shown) =>
  placedFor?.text === shown.text && placedFor.isOverGames === shown.isOverGames;

/**
 * Places the list once for each search and whether rows sit over its games, so a redraw, as each
 * minute, keeps where it's been scrolled.
 * @param {Shown} shown
 * @param {ListPlace} place
 */
function placeOnce(shown, place) {
  if (isPlacedFor(shown)) return;
  placedFor = shown;
  placeList(place);
}

/**
 * Runs a whole search, as a tapped suggestion or example does, putting the keyboard away.
 * @param {string} text
 */
function runSearch(text) {
  writeQuery(text);
  isTyping = false;
  isGamesOnly = false;
  findInput()?.blur();
  draw();
}

/**
 * A tap on the line over the games shows them whole, as a search of games alone does, with the
 * words the line read in the field.
 * @param {string} text
 */
function showGamesOnly(text) {
  writeQuery(text);
  isTyping = false;
  isGamesOnly = true;
  findInput()?.blur();
  draw();
}

/**
 * Opens the search with an empty field and the keyboard up, from a tap, which a phone needs to
 * bring up the keyboard.
 */
function openGameSearch() {
  if (!view) return;
  writeQuery("");
  isTyping = true;
  isGamesOnly = false;
  view.hidden = false;
  draw();
  findInput()?.focus();
}

/** Empties the open search's field for a new search, with the keyboard up, from a tap. */
function startGameSearchOver() {
  writeQuery("");
  isTyping = true;
  isGamesOnly = false;
  draw();
  findInput()?.focus();
}

// Search opens with the keyboard up from the tap on its tab, or as it was left, while it's open.
function enterSearch() {
  if (view?.hidden) openGameSearch();
}

// A search that closes while it shows goes back to the tab before it.
function leaveSearchTab() {
  if (readShownTab() === "search") openPageTab(readTabBefore() ?? "games");
}

/** Closes the search, emptying its field. */
function closeGameSearch() {
  if (!view || view.hidden) return;
  findInput()?.blur();
  writeQuery("");
  isTyping = false;
  isGamesOnly = false;
  placedFor = null;
  view.hidden = true;
  leaveSearchTab();
}

// A finger dragging the list puts the keyboard away, as an iPhone's own searches do, so the rest of
// the list shows.
function putKeyboardAway() {
  const input = findInput();
  if (input && document.activeElement === input) input.blur();
}

/** Draws the search again from the season, as new data or the clock moves on. */
export function refreshGameSearch() {
  if (view && !view.hidden) draw();
}

/** @param {Event} event */
function followTap(event) {
  const target = /** @type {Element} */ (event.target);
  const chosen = /** @type {HTMLElement | null} */ (target.closest("[data-search]"));
  const place = /** @type {HTMLElement | null} */ (target.closest("[data-place]"));
  const gamesLine = /** @type {HTMLElement | null} */ (target.closest(".search-games-line"));
  if (chosen) runAfterPress(chosen, () => runSearch(chosen.dataset.search ?? ""));
  else if (place) runAfterPress(place, () => league?.openPlace(place.dataset.place ?? ""));
  else if (gamesLine) runAfterPress(gamesLine, () => showGamesOnly(gamesLine.dataset.games ?? ""));
  else if (target.closest(".search-cancel")) closeGameSearch();
  else if (target.closest(".search-clear")) startGameSearchOver();
}

function followTyping() {
  writeQuery(readQuery());
  isTyping = true;
  isGamesOnly = false;
  draw();
}

// A tap on the field goes back to what typing showed, as an iPhone's search does.
/** @param {Event} event */
function followFocus(event) {
  if (!(/** @type {Element} */ (event.target).closest(".search-input")) || isTyping) return;
  isTyping = true;
  isGamesOnly = false;
  draw();
}

/** @param {Event} event */
function sendSearch(event) {
  event.preventDefault();
  const season = league?.readSeason();
  const query = readQuery();
  const pages = league?.readPages() ?? null;
  runSearch(season ? readSentWords(query, createContext(season), pages) : query);
}

/**
 * Names the field by what it finds, which the shell leaves to the league.
 * @param {string} placeholder
 */
function nameField(placeholder) {
  const input = findInput();
  input?.setAttribute("placeholder", placeholder);
  input?.setAttribute("aria-label", placeholder);
}

/**
 * Draws the shell again over one put back from an earlier release, keeping the words it held.
 * @param {HTMLElement} element
 */
function redrawOldShell(element) {
  const query = readQuery();
  setHtml(element, renderSearchShell());
  writeQuery(query);
}

/**
 * Wires the search in `element`, which the page may already have put back as it was shown before a
 * reload (show-last-drawn.js), then takes it over, keeping where its list was scrolled.
 * @param {HTMLElement} element
 * @param {SearchLeague} searchLeague
 */
export function startGameSearch(element, searchLeague) {
  view = element;
  league = searchLeague;
  const isOldShell = !hasCurrentShell();
  if (isOldShell) redrawOldShell(element);
  nameField(searchLeague.placeholder);
  placedFor =
    element.hidden || isOldShell
      ? null
      : {
          text: readQuery().trim(),
          isOverGames: !!element.querySelector(".search-games-line"),
        };
  element.addEventListener("click", followTap);
  element.addEventListener("focusin", followFocus);
  element.addEventListener("input", followTyping);
  element.addEventListener("submit", sendSearch);
  findList()?.addEventListener("scroll", followScroll, { passive: true });
  findList()?.addEventListener("touchmove", putKeyboardAway, { passive: true });
  setTabStart("search", startGameSearchOver);
  setTabEnter("search", enterSearch);
  watchTimeAway((awayMs) => {
    if (isAwayLong(awayMs)) closeGameSearch();
  });
}
