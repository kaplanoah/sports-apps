// The sheet every game opens, from its row, an update about it, or its card on a club's sheet, in
// sections under pills: Game, the game's row with its score and status as the store updates
// them, where to watch it, its starters on one line that slides to Matchup, which sets the two face
// to face (matchup.js), its season series before first pitch (season-series.js), and its box score
// (box-score-view.js), which the store pushes as it changes, and, once the game is final,
// Highlights, its recap and each play's clip (highlights-section.js).
// Phones show it over the whole screen, wider screens as a modal, like Settings.

import { fetchBoxScore } from "./box-score-fetch.js";
import { renderBoxScore } from "./box-score-view.js";
import { renderTeamDot } from "./clubs.js";
import { fetchHighlights } from "./highlights-fetch.js";
import {
  describeInning,
  groupShownSeriesFinals,
  nameGame,
  renderArm,
  renderGameFaceOff,
} from "./games-view.js";
import { listSeasonGames, nameGameKey } from "./season-games.js";
import { describeDay, readCalendarDate } from "#shared/days.js";
import { watchGameOpens } from "#shared/game-row.js";
import { createHighlightsSection } from "#shared/highlights-section.js";
import { html, joinWithSeparator, setHtml } from "#shared/html.js";
import {
  isLoadingSide,
  isNewStarter,
  listSides,
  loadSide,
  renderMatchupBody,
  updateSides,
} from "./matchup.js";
import { renderNetworks } from "#shared/network-logos.js";
import { watchRetries } from "#shared/retry.js";
import { countClubGames } from "./qualifying.js";
import { renderSeasonSeries } from "./season-series.js";
import { describeSeriesAt, isSeriesGame, nameSeriesGame } from "./series-games.js";
import { session } from "./session.js";
import { wireSheetSections } from "#shared/sheet-sections.js";
import { openSheet, wireSheet } from "#shared/sheet.js";
import { letGoOfGame, noteShownGame } from "#shared/sheet-memory.js";

/** @typedef {import("./matchup.js").MatchupGame} MatchupGame */
/** @typedef {{ game: MatchupGame, sides: any[], boxScore: any }} ShownGame */

const SIDES = ["away", "home"];
const STATE_ORDER = ["pre", "live", "final"];

// Phosphor's caret-right, at its Regular weight.
const STARTERS_CARET = html`<svg class="starters-caret" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"
  />
</svg>`;

/** @type {ShownGame | null} */
let shown = null;
/** @type {(() => void) | null} */
let unwatchBoxScore = null;
/** @type {ReturnType<typeof wireSheetSections> | null} */
let sections = null;
/** @type {ReturnType<typeof createHighlightsSection> | null} */
let highlights = null;

const findSheet = () => /** @type {HTMLElement} */ (document.getElementById("gameSheet"));
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * The game as the slate or the season's schedule has it now, with whether it's today's, when a
 * club yet to name its starter shows who it might be.
 * @param {string} key
 * @returns {MatchupGame | null}
 */
function findGame(key) {
  const slate = session.state?.slate;
  const games = listSeasonGames(slate, session.schedule);
  const game = games.find((each) => !each.allStar && nameGameKey(each) === key);
  return game ? { ...game, today: game.date === slate?.today.date } : null;
}

// Once the slate has moved past a game's day, the sheet shows it as it was when it opened.
/** @param {MatchupGame} game */
const readCurrentGame = (game) => findGame(nameGameKey(game)) ?? game;

// A postseason game is titled with its round and game, and any other with its clubs.
/** @param {MatchupGame} game */
export const titleGame = (game) => (isSeriesGame(game) ? nameSeriesGame(game) : nameGame(game));

// Where its series stood at the game, then its day; the game's row under it shows its time.
/** @param {MatchupGame} game */
export const renderWhen = (game) =>
  joinWithSeparator(
    [
      describeSeriesAt(game, groupShownSeriesFinals()),
      describeDay(readCalendarDate(game.date), Date.now()),
    ].filter(Boolean),
  );

const nameStarter = (side) => side.pitcher?.lastName || side.starter?.name || "TBD";

function renderStarter(side) {
  const hand = side.pitcher?.hand || side.starter?.hand;
  return html`<span class="starters-side ${side.key}"
    >${side.club ? renderTeamDot(side.club) : html``}<span class="starters-name">${nameStarter(side)}</span
    >${renderArm(hand)}</span
  >`;
}

/** @param {any[]} sides */
function renderStarters(sides) {
  if (!sides.some((side) => side.starter?.name)) return html``;
  const label = `Pitching matchup: ${sides.map(nameStarter).join(" vs ")}`;
  return html`<button type="button" class="starters-open" aria-label="${label}">
    ${renderStarter(sides[0])}<span class="starters-versus">vs</span>${renderStarter(sides[1])}${STARTERS_CARET}
  </button>`;
}

// Only a game still to be played says where it's on.
/** @param {MatchupGame} game */
const renderWhereToWatch = (game) =>
  game.state === "pre" || game.state === "live" ? renderNetworks(game.networks ?? []) : html``;

// Every game of the season the page has, or null before its schedule has loaded.
const listKnownGames = () =>
  session.schedule ? listSeasonGames(session.state?.slate, session.schedule) : null;

/**
 * The Game section: the game's row, where to watch it, its starters, its season series before
 * first pitch, and its box score.
 * @param {MatchupGame} game
 * @param {any[]} sides
 * @param {any} [boxScore]
 */
export const renderGameBody = (game, sides, boxScore = null) =>
  html`${renderGameFaceOff(game)}${renderWhereToWatch(game)}${renderStarters(sides)}${renderSeasonSeries(game, listKnownGames())}${renderBoxScore(game, boxScore)}`;

/**
 * How far a box score has come: its game's state, then its plate appearances, then its players,
 * since lineups are posted, batters come up, and pitchers come in, but none of it goes back.
 * @param {any} boxScore
 */
function measureProgress(boxScore) {
  const players = SIDES.flatMap((side) => [...boxScore[side].batters, ...boxScore[side].pitchers]);
  const plateAppearances = players.reduce(
    (total, player) => total + (player.atBats ?? 0) + (player.walks ?? 0),
    0,
  );
  return [STATE_ORDER.indexOf(boxScore.state), plateAppearances, players.length];
}

/**
 * Whether `pushed` is from before `current`, as the store's copy can be when a sheet's own read of
 * MLB came after it.
 * @param {any} pushed
 * @param {any} current
 */
export function isEarlierBoxScore(pushed, current) {
  if (!current) return false;
  const [pushedProgress, currentProgress] = [measureProgress(pushed), measureProgress(current)];
  const index = pushedProgress.findIndex((value, place) => value !== currentProgress[place]);
  return index !== -1 && pushedProgress[index] < currentProgress[index];
}

/**
 * Whether the game's box score has anything to show: a club's lineup, posted on its day, or what
 * has happened since it started.
 * @param {MatchupGame} game
 */
const hasBoxScore = (game) =>
  game.state === "live" || game.state === "final" || (game.state === "pre" && !!game.today);

/**
 * The score after a play that scored, the club that scored it in bold.
 * @param {MatchupGame} game
 * @param {any} clip
 */
const renderPlayScore = (game, clip) =>
  html`${SIDES.map(
    (side, index) =>
      html`${index > 0 && ", "}${
        clip.scorer === side
          ? html`<b>${game[side]} ${clip.score[index]}</b>`
          : `${game[side]} ${clip.score[index]}`
      }`,
  )}`;

/**
 * Where in the game a play came, and the score after it when it scored.
 * @param {any} clip
 */
function describePlay(clip) {
  const game = shown && readCurrentGame(shown.game);
  return [describeInning(clip), game && clip.score ? renderPlayScore(game, clip) : ""];
}

/** @param {string} id */
const loadHighlights = (id) => () => fetchHighlights(id);

// A final offers its highlights, and any other game hides their pill, leaving the section if it
// showed.
/** @param {MatchupGame} game */
function offerHighlights(game) {
  const isFinal = game.state === "final" && Boolean(game.id);
  findElement("gameTabHighlights").hidden = !isFinal;
  if (isFinal) highlights?.show(game.id, loadHighlights(game.id));
  else if (sections?.readShown() === "highlights") sections.showSection("game", true);
}

// A game called off is over as much as a final, and won't be played on its day.
/** @param {MatchupGame} game */
const isOver = (game) => game.state === "final" || game.state === "off";

/** @param {MatchupGame} game */
function noteGame(game) {
  noteShownGame(findSheet(), {
    key: nameGameKey(game),
    isPlayingToday: game.state === "live" || (game.state === "pre" && !!game.today),
    isOver: isOver(game),
  });
}

function renderSheet() {
  if (!shown) return;
  const game = readCurrentGame(shown.game);
  noteGame(game);
  offerHighlights(game);
  setHtml(findElement("gameTitle"), titleGame(game));
  setHtml(findElement("gameWhen"), renderWhen(game));
  setHtml(findElement("gameBody"), renderGameBody(game, shown.sides, shown.boxScore));
  const matchup = findElement("matchupBody");
  const countGames = (/** @type {string} */ club) => countClubGames(club, session.activeYear);
  setHtml(matchup, renderMatchupBody(game, shown.sides, countGames));
  matchup.setAttribute("aria-busy", String(shown.sides.some((side) => isLoadingSide(side, game))));
}

function stopWatchingBoxScore() {
  unwatchBoxScore?.();
  unwatchBoxScore = null;
}

/**
 * Takes a box score the Worker read or the store pushed, unless the sheet has moved on to another
 * game or already shows a later one.
 * @param {ShownGame} opened
 * @param {any} boxScore
 */
function applyBoxScore(opened, boxScore) {
  if (shown !== opened || !boxScore || isEarlierBoxScore(boxScore, opened.boxScore)) return;
  opened.boxScore = boxScore;
  renderSheet();
}

// Until a game's final box score shows, the store reads it with each update while a page watches
// it, and pushes it.
/** @param {ShownGame} opened */
function watchBoxScore(opened) {
  stopWatchingBoxScore();
  if (opened.boxScore?.state === "final") return;
  unwatchBoxScore = session.db.doc(`games/${opened.game.id}`).onSnapshot((snapshot) => {
    if (snapshot.exists) applyBoxScore(opened, snapshot.data());
  });
}

// A read that fails keeps the box score already showing.
/** @param {ShownGame} opened */
async function loadBoxScore(opened) {
  const game = readCurrentGame(opened.game);
  if (!game.id || !hasBoxScore(game)) return;
  try {
    applyBoxScore(opened, await fetchBoxScore(game.id));
  } catch {
    // The store's copy, or the next update, may still bring it.
  }
  if (shown === opened) watchBoxScore(opened);
}

/**
 * Loads each of the sides, drawing the sheet again as each arrives, unless it has moved on to
 * another game.
 * @param {ShownGame} opened
 * @param {any[]} sides
 * @param {MatchupGame} game
 */
const loadSides = (opened, sides, game) =>
  Promise.all(
    sides.map((side) =>
      loadSide(side, game, session.activeYear).then(() => {
        if (shown === opened) renderSheet();
      }),
    ),
  );

/**
 * Draws the game, then each side of its matchup and its box score again as they load.
 * @param {MatchupGame} game
 * @param {any[]} sides
 * @param {any} [boxScore] what the sheet showed before a reload
 */
async function showGame(game, sides, boxScore = null) {
  const opened = { game, sides, boxScore };
  shown = opened;
  stopWatchingBoxScore();
  renderSheet();
  loadBoxScore(opened);
  await loadSides(opened, sides, game);
}

// Each side that didn't load shows its placeholders again while it reads again.
async function retryFailedSides() {
  const opened = shown;
  const failed = opened?.sides.filter((side) => side.failure) ?? [];
  if (!opened || failed.length === 0) return;
  for (const side of failed) side.failure = null;
  renderSheet();
  await loadSides(opened, failed, readCurrentGame(opened.game));
}

// A starter the store names after the sheet opened, or names again, takes his side's place.
/** @param {ShownGame} opened */
function updateStarters(opened) {
  const game = readCurrentGame(opened.game);
  const sides = updateSides(opened.sides, game);
  const named = sides.filter((side, index) =>
    isNewStarter(opened.sides[index].starter, side.starter),
  );
  opened.sides = sides;
  if (named.length > 0) loadSides(opened, named, game);
}

/**
 * @param {MatchupGame} game
 * @param {string} [section] the section to open on, or its first
 */
function openGameSheet(game, section) {
  openSheet(findSheet(), {
    key: nameGameKey(game),
    show: () => {
      highlights?.forget();
      showGame(game, listSides(game));
      if (section) sections?.showSection(section, true);
      else sections?.showFirstSection();
    },
  });
}

/**
 * Opens a game's sheet on one of its sections, as a search does.
 * @param {string} key the game's, from nameGameKey
 * @param {string} section
 */
export function openGameSection(key, section) {
  const game = findGame(key);
  if (game) openGameSheet(game, section);
}

const readShownGame = () =>
  shown && {
    ...shown,
    section: sections?.readShown() ?? null,
    highlights: highlights?.read() ?? null,
  };

// What each side, the box score, and the highlights showed stays until they load again.
/** @param {(ShownGame & { section?: unknown, highlights?: any }) | null} saved */
function reopenGameSheet(saved) {
  if (!saved?.game || !Array.isArray(saved.sides)) return false;
  const kept = saved.highlights;
  if (kept?.id === saved.game.id && kept.highlights)
    highlights?.show(kept.id, loadHighlights(kept.id), kept.highlights);
  showGame(saved.game, saved.sides, saved.boxScore ?? null);
  if (typeof saved.section === "string") sections?.showSection(saved.section, true);
  return true;
}

/**
 * Redraws the open sheet from the season as the store has it now. A starter named since the sheet
 * read its sides reads his, and a game that started since the sheet read its box score, or whose
 * day came, reads it again.
 */
export function refreshGameSheet() {
  if (!shown) return;
  updateStarters(shown);
  renderSheet();
  const game = readCurrentGame(shown.game);
  const isOutOfStep = !shown.boxScore || shown.boxScore.state !== game.state;
  if (isOutOfStep && hasBoxScore(game) && game.state !== "final") loadBoxScore(shown);
}

/** @param {HTMLElement} button */
const findButtonGame = (button) => findGame(button.dataset.game ?? "");

/** @param {HTMLElement} button */
function openFromButton(button) {
  const game = findButtonGame(button);
  if (game) openGameSheet(game);
}

/** @param {HTMLElement} button */
function prepareFromButton(button) {
  const game = findButtonGame(button);
  if (!game) return;
  for (const side of listSides(game)) loadSide(side, game, session.activeYear);
}

/** @param {Event} event */
function showMatchupOnTap(event) {
  if (/** @type {Element} */ (event.target).closest(".starters-open"))
    sections?.showSection("matchup");
}

export function startGameSheet() {
  const sheet = findSheet();
  sections = wireSheetSections(sheet);
  highlights = createHighlightsSection(findElement("highlightsBody"), describePlay);
  for (const holder of ["seasonGames", "gameSearch", "updates", "teamBody"])
    watchGameOpens(findElement(holder), { open: openFromButton, prepare: prepareFromButton });
  findElement("gameBody").addEventListener("click", showMatchupOnTap);
  watchRetries(sheet, () => {
    retryFailedSides();
    if (shown?.game.id) highlights?.retry(loadHighlights(shown.game.id));
  });
  wireSheet(sheet, {
    findScroller: sections.findShownSection,
    keeper: { read: readShownGame, reopen: reopenGameSheet },
    name: "Game",
    forget: () => {
      stopWatchingBoxScore();
      highlights?.forget();
      letGoOfGame(sheet);
      shown = null;
    },
  });
}
