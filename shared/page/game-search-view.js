// A search over a season's games, and the league's teams and players and its other pages too: a
// field with Cancel, then what the words find. Before anything is
// typed, quiet examples to tap sit under the field, inside its width. While words are typed,
// suggestions sit over the pages the words name, like a team's sheet, then a line saying how the
// search read the words, right over the games it found from today on, which a tap on the line opens
// whole. A search sent shows the same without the suggestions, or, when its words ask only for
// games, the games at once, the line under the field and the list opening on the first from today,
// as does a tap on the line. A tap on the field goes back to what typing showed. A reload shows the
// search as it was, and two minutes away closes it. A league hands it its season's games and words,
// how it draws a day's games, a team's dot, its pages and how it opens them, and what the search
// does as it closes.

import { describeDay, readCalendarDate } from "./days.js";
import {
  createSearchContext,
  createSearchDictionary,
  describeNoGames,
  describeSearch,
  findSearchGames,
  readSearch,
} from "./game-search.js";
import { html, joinWithSeparator, setHtml } from "./html.js";
import { isAwayLong } from "./long-away.js";
import { chooseDayMarkup, hasStandIns, listDaysAround, measureNearDays } from "./near-days.js";
import { isWebAddress } from "./news-picks.js";
import { nameStoryDay } from "./news-view.js";
import { SHORTEST_PREFIX, findPages, findPartGame } from "./page-search.js";
import { runAfterPress } from "./press.js";
import { watchTimeAway } from "./resume.js";
import {
  EXAMPLE_COUNT,
  listExamples,
  listOtherReadings,
  listSuggestions,
} from "./search-suggestions.js";

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {import("./game-search.js").SearchGame} SearchGame */
/** @typedef {import("./game-search.js").SearchTerms} SearchTerms */
/** @typedef {import("./search-suggestions.js").Suggestion} Suggestion */
/** @typedef {import("./page-search.js").SearchPages} SearchPages */
/** @typedef {import("./page-search.js").PageRow} PageRow */
/** @typedef {import("./page-search.js").GamePart} GamePart */
/** @typedef {import("./day-strip.js").ListedDay} ListedDay */
/**
 * A page's row as the search shows it, a game's part on the game it opens.
 * @typedef {Exclude<PageRow, { kind: "game-part" }> | { kind: "game", part: GamePart, game: SearchGame }} ShownRow
 */
/**
 * What a league hands its search.
 * @typedef {object} SearchLeague
 * @property {() => { terms: SearchTerms, games: SearchGame[] } | null} readSeason the season shown,
 *   or null before the page has one
 * @property {(games: SearchGame[], now: number) => ListedDay[]} listDays the days of the games
 *   found, drawn as the Games view draws them, with a stand-in for each when it has them
 * @property {(code: string) => Markup} renderTeamMark a team's dot
 * @property {() => void} close what the view does as the search closes, like going back to the tab
 *   before it
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
// The search and its suggestions the list was last placed for, so a redraw keeps where it is.
/** @type {string | null} */
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

const renderShell = () =>
  html`<div class="day-bar search-bar is-empty">
      <form class="search-row" role="search">
        <label class="search-field"
          >${FIELD_GLASS}<input
            type="search"
            class="search-input"
            value=""
            enterkeyhint="search"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false" /><button type="button" class="search-clear" aria-label="Clear" hidden>
            ${CLEAR}
          </button></label
        >
        <button type="button" class="search-cancel">Cancel</button>
      </form>
      <p class="search-read"></p>
    </div>
    <div class="day-list search-list"></div>`;

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
          html`<li><button type="button" class="search-example" data-search="${example}">${example}</button></li>`,
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
          <button type="button" class="search-suggestion" data-search="${text}">
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
    return html`type="button" class="search-suggestion" data-place="${row.place.key}" aria-label="${row.place.name.join(", ")}"`;
  if (row.kind === "game")
    return html`type="button" class="search-suggestion" data-place="${row.part.key}:${row.game.id}"`;
  if (row.kind === "story") return html``;
  const section = row.kind === "team" ? "" : (pages.section?.key ?? "");
  const opens = html`type="button" class="search-suggestion team-open" data-team="${row.team.code}" data-team-section="${section}"`;
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
  const quoted = row.kind === "story" ? html` data-quoted` : html``;
  const content = html`<span class="search-mark">${mark}</span><span class="search-words"${quoted}
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
          class="search-suggestion"
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
 * The rows to show, each game's part on the game it opens of those the words left for it find, and
 * left out when there's none.
 * @param {PageRow[]} rows
 * @param {import("./game-search.js").SearchContext} context
 * @returns {ShownRow[]}
 */
const placeGameParts = (rows, context) =>
  rows.flatMap((row) => {
    if (row.kind !== "game-part") return [/** @type {ShownRow} */ (row)];
    const games =
      row.gameText === null
        ? context.games
        : findSearchGames(readSearch(row.gameText, context), context).games;
    const game = findPartGame(games, row.part);
    return game ? [/** @type {ShownRow} */ ({ kind: "game", part: row.part, game })] : [];
  });

/**
 * The line saying how the search read its words, right over the games, which a tap opens whole,
 * with the words as it read them, a half-typed team's or place's finished.
 * @param {{ lead: string, facts: string[] }} read
 * @param {string} readText
 */
const renderGamesLine = (read, readText) =>
  html`<button type="button" class="search-games-line" data-games="${readText}">
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
 * @param {string} shown
 */
function keepListedDays(days, startDay, shown) {
  if (shown !== placedFor) nearDays = startDay ? listDaysAround(days, startDay) : new Set();
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
 * The day a new search places the list on: the first from today, or the last when every one is
 * past, or the first when rows sit over the games.
 * @param {ListedDay[]} days
 * @param {string} today
 * @param {boolean} isOverGames
 */
function findStartDay(days, today, isOverGames) {
  if (isOverGames) return days[0]?.day ?? null;
  return (days.find(({ day }) => day >= today) ?? days.at(-1))?.day ?? null;
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
 * Places the list on the first day found from today, with room after the last day for it to reach
 * the top, or, when every day found is past, or rows sit over the games, at its end or its top.
 * @param {string} today
 * @param {boolean} isOverGames
 */
function placeList(today, isOverGames) {
  const list = findList();
  if (!list) return;
  const days = /** @type {HTMLElement[]} */ ([...list.querySelectorAll(".listed-day")]);
  const gap = Number.parseFloat(getComputedStyle(list).paddingTop) || 0;
  const ahead = isOverGames ? null : days.find((each) => (each.dataset.day ?? "") >= today);
  const last = days.at(-1);
  const room = ahead && last ? list.clientHeight - last.offsetHeight - gap : 0;
  list.style.setProperty("--end-room", `${Math.max(0, room)}px`);
  if (ahead) list.scrollTop = Math.max(0, ahead.offsetTop - gap);
  else list.scrollTop = isOverGames ? 0 : list.scrollHeight;
  markStuck();
}

// The bar ends in a line once something has scrolled under it, as the day strip's does.
function markStuck() {
  findBar()?.classList.toggle("stuck", (findList()?.scrollTop ?? 0) > 0);
}

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

/**
 * The games from today on, or, when none are left, all of them.
 * @param {SearchGame[]} games
 * @param {string} today
 */
function listFromToday(games, today) {
  const ahead = games.filter((game) => game.day >= today);
  return ahead.length ? ahead : games;
}

/**
 * What the line reads while words are typed: a half-typed team or place as the one the first
 * suggestion finishes it into, and any other half-typed word left out until it's whole, rather than
 * named as one it can't use.
 * @param {string} text
 * @param {Suggestion[]} suggestions
 * @param {import("./game-search.js").SearchContext} context
 */
function readWhileTyping(text, suggestions, context) {
  if (!isTyping || !isLastWordHalfTyped(text, context)) return text;
  const last = text.split(/\s+/).at(-1) ?? "";
  return finishName(text, suggestions) ?? text.slice(0, text.length - last.length).trim();
}

/**
 * Whether the last word is one the search can't read yet, as a word still being typed is.
 * @param {string} text
 * @param {import("./game-search.js").SearchContext} context
 */
function isLastWordHalfTyped(text, context) {
  const last = text.split(/\s+/).at(-1) ?? "";
  return readSearch(text, context).skipped.includes(last.toLowerCase());
}

/**
 * The words with a half-typed team or place finished, as the first suggestion finishes it, or null
 * when the first suggestion doesn't finish one or the last word is too short to name one yet.
 * @param {string} text
 * @param {Suggestion[]} suggestions
 */
function finishName(text, [first]) {
  const last = text.split(/\s+/).at(-1) ?? "";
  const isNameFinished =
    last.length >= SHORTEST_PREFIX &&
    (first?.mark.kind === "team" || first?.mark.kind === "place") &&
    first.text.toLowerCase().startsWith(text.toLowerCase());
  return isNameFinished ? first.text : null;
}

/**
 * The suggestions less a team whose page shows under them, since its page's row stands for it.
 * @param {Suggestion[]} suggestions
 * @param {ShownRow[]} rows
 */
function dropTeamsShown(suggestions, rows) {
  const shown = new Set(rows.flatMap((row) => (row.kind === "team" ? [row.team.code] : [])));
  return suggestions.filter(({ mark }) => mark.kind !== "team" || !shown.has(mark.code));
}

/**
 * The pages the words ask for, the words left for the search of games, or null when they ask for
 * no games, and the line an answer says over its rows. A half-typed word may start a player's name
 * or a place's, so the words as typed go first, and the words as the line reads them only when
 * those find no page.
 * @param {string} text
 * @param {string} readText the words as the line reads them while they're typed
 * @param {import("./game-search.js").SearchContext} context
 * @returns {{ pages: SearchPages | null } & import("./page-search.js").FoundPages}
 */
function readPages(text, readText, context) {
  const pages = league?.readPages() ?? null;
  if (!pages) return { pages, rows: [], gameText: readText };
  const search = { dictionary: context.dictionary, pages, isTyping };
  const typed = findPages(text, search);
  return { pages, ...(typed.rows.length ? typed : findPages(readText, search)) };
}

/**
 * The examples to offer: the league's searches of games, then its pages that find something.
 * @param {import("./game-search.js").SearchContext} context
 */
function listShownExamples(context) {
  const pages = league?.readPages() ?? null;
  const pageExamples = (pages?.examples ?? []).filter(
    (example) =>
      findPages(example, { dictionary: context.dictionary, pages, isTyping: false }).rows.length,
  );
  return [...listExamples(context, EXAMPLE_COUNT - pageExamples.length), ...pageExamples];
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
  findBar()?.classList.toggle("is-empty", !text);
  if (!text) {
    findBar()?.classList.remove("has-rows");
    setHtml(readLine, html``);
    listedDays = [];
    setHtml(list, renderExamples(listShownExamples(context)));
    placeOnce(nameShown("", false), context.today);
    return;
  }
  const typed = isTyping ? listSuggestions(query, context) : [];
  const readText = readWhileTyping(text, typed, context);
  const { pages, rows: pageRows, gameText, read: answer } = readPages(text, readText, context);
  const rows = placeGameParts(pageRows, context);
  const suggestions = dropTeamsShown(typed, rows);
  const others = gameText && !isGamesOnly ? listOtherReadings(gameText, context) : [];
  const search = gameText ? readSearch(gameText, context) : null;
  const found = search && findSearchGames(search, context);
  const read = search && found && describeSearch(search, found, context);
  const isOverGames =
    !isGamesOnly && (suggestions.length > 0 || rows.length > 0 || others.length > 0);
  findBar()?.classList.toggle("has-rows", isOverGames);
  setHtml(readLine, renderReadLine(answer ?? (isOverGames ? null : read)));
  const shown = nameShown(text, isOverGames);
  if (!isOverGames) {
    const days = found?.games.length ? league.listDays(found.games, Date.now()) : [];
    keepListedDays(days, findStartDay(days, context.today, false), shown);
    const games = days.length
      ? renderDays(days)
      : html`<p class="empty-note">${search && describeNoGames(search, context)}</p>`;
    setHtml(list, games);
    showDays(shown, context.today);
    return;
  }
  const shownGames = read && found ? listFromToday(found.games, context.today) : [];
  const days = shownGames.length ? league.listDays(shownGames, Date.now()) : [];
  keepListedDays(days, findStartDay(days, context.today, true), shown);
  setHtml(
    list,
    html`${suggestions.length > 0 && renderSuggestions(suggestions, query)}${
      pages && rows.length > 0 && renderPageRows(rows, pages, context)
    }${others.length > 0 && renderSuggestions(others, "")}${
      days.length > 0 && html`${renderGamesLine(read, readText)}${renderDays(days)}`
    }`,
  );
  showDays(shown, context.today);
}

/**
 * Brings each day the list draws up to date, places a new search, and draws whole the days it put
 * near the screen.
 * @param {string} shown
 * @param {string} today
 */
function showDays(shown, today) {
  writeListedDays(listedDays);
  placeOnce(shown, today);
  drawNearDays();
}

/**
 * What the list shows, for placing it once for each.
 * @param {string} text the search
 * @param {boolean} isOverGames whether rows sit over the games
 */
const nameShown = (text, isOverGames) => `${text}\n${isOverGames}`;

/**
 * Places the list once for each search and whether rows sit over its games, so a redraw, as each
 * minute, keeps where it's been scrolled.
 * @param {string} shown
 * @param {string} today
 */
function placeOnce(shown, today) {
  if (shown === placedFor) return;
  placedFor = shown;
  placeList(today, shown.endsWith("\ntrue"));
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
export function openGameSearch() {
  if (!view) return;
  writeQuery("");
  isTyping = true;
  isGamesOnly = false;
  view.hidden = false;
  draw();
  findInput()?.focus();
}

/** Empties the open search's field for a new search, with the keyboard up, from a tap. */
export function startGameSearchOver() {
  writeQuery("");
  isTyping = true;
  isGamesOnly = false;
  draw();
  findInput()?.focus();
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
  league?.close();
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
  runSearch(readSentWords(readQuery()));
}

/**
 * The words the Search key sends: a half-typed last word finished when it starts a team or a place,
 * as the line read it while typing, and otherwise the words as typed.
 * @param {string} query
 */
function readSentWords(query) {
  const season = league?.readSeason();
  if (!season) return query;
  const context = createContext(season);
  const text = query.trim();
  if (!isLastWordHalfTyped(text, context)) return query;
  return finishName(text, listSuggestions(query, context)) ?? query;
}

/**
 * Names the field by what it finds, as a field put back from an earlier release may not.
 * @param {string} placeholder
 */
function nameField(placeholder) {
  const input = findInput();
  input?.setAttribute("placeholder", placeholder);
  input?.setAttribute("aria-label", placeholder);
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
  if (!findInput()) setHtml(element, renderShell());
  nameField(searchLeague.placeholder);
  placedFor = element.hidden
    ? null
    : nameShown(readQuery().trim(), !!element.querySelector(".search-games-line"));
  element.addEventListener("click", followTap);
  element.addEventListener("focusin", followFocus);
  element.addEventListener("input", followTyping);
  element.addEventListener("submit", sendSearch);
  findList()?.addEventListener("scroll", followScroll, { passive: true });
  findList()?.addEventListener("touchmove", putKeyboardAway, { passive: true });
  watchTimeAway((awayMs) => {
    if (isAwayLong(awayMs)) closeGameSearch();
  });
}
