// The sheet a game's row opens: the two teams across the score in its top, then the game's box
// score once it has started, or a preview before it does. Once the game is over, pills in its top
// slide between the box score and its Highlights, its recap and each play's clip
// (highlights-section.js). Phones show it as a sheet from the bottom that a swipe down closes,
// wider screens as a modal, like Settings. A team's sheet opens it beside itself
// from the cards of the team's nearest games. Details that didn't load read again on a tap on Try
// again, as the phone comes back online, or as the page comes back.

import { describeDay } from "#shared/days.js";
import { html, joinWithSeparator, setHtml } from "#shared/html.js";
import { watchGameOpens } from "#shared/game-row.js";
import { createHighlightsSection } from "#shared/highlights-section.js";
import { renderNetworks } from "#shared/network-logos.js";
import { classifyReadFailure, renderRetryBlock, watchRetries } from "#shared/retry.js";
import { wireSheetSections } from "#shared/sheet-sections.js";
import { openSheet, wireSheet } from "#shared/sheet.js";
import { letGoOfGame, noteShownGame } from "#shared/sheet-memory.js";
import { renderBoxScore, renderPendingBoxScore } from "./box-score-view.js";
import { renderClub } from "./clubs.js";
import { isGameToday, readGameDay } from "./days.js";
import { fetchBoxScore, fetchHighlights, fetchLead, fetchPreview } from "./game-details-fetch.js";
import {
  describeFinalInSeries,
  findLoser,
  listSeasonGames,
  nameGame,
  renderHeadline,
  renderStatus,
} from "./games-view.js";
import { renderPreview } from "./preview-view.js";
import { describeSeriesStanding } from "./series.js";
import { session } from "./session.js";
import { formatSheetColors } from "./sheet-colors.js";
import { renderSheetMessage } from "./sheet-parts.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {{ id: string, kind: "box" | "preview", details: any, error: any, lead: any, isLeadLoading: boolean }} ShownGame */

// The game the sheet shows. Each opening, and each switch to a box score, is a new one, so an
// answer that arrives after it changed is dropped.
/** @type {ShownGame | null} */
let shown = null;
/** @type {(() => void) | null} */
let unwatchDetails = null;
/** @type {ReturnType<typeof wireSheetSections> | null} */
let sections = null;
/** @type {ReturnType<typeof createHighlightsSection> | null} */
let highlights = null;

const findSheet = () => /** @type {HTMLElement} */ (document.getElementById("gameSheet"));
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

// A game may be a playoff game, a team's nearest, or any other of the season's, which only its
// list of every game holds, and the season's own copy, which carries a game while it's played,
// comes first.
/** @param {string} id */
const findGame = (id) =>
  listSeasonGames(session.season, session.schedule).find((game) => game.id === id) ?? null;

/** @param {Game} game */
const chooseKind = (game) => (game.state === "pre" ? "preview" : "box");

// A final tells how it left its series, and any other game how the series stands now.
/** @param {Game} game */
function describeSeries(game) {
  if (game.state === "final") return describeFinalInSeries(game, session.season?.games ?? []);
  return describeSeriesStanding(session.season?.series?.find((each) => each.id === game.series));
}

/** @param {Game} game */
function renderWhen(game) {
  const day = readGameDay(game);
  return joinWithSeparator(
    [describeSeries(game), day && describeDay(day, Date.now())].filter(Boolean),
  );
}

/** @param {string} team */
function describeRecord(team) {
  const row = session.season?.standings?.find((each) => each.team === team);
  return row ? `${row.wins}-${row.losses}` : "";
}

/**
 * @param {Game} game
 * @param {"away" | "home"} place
 */
const renderBonus = (game, place) =>
  game.state === "live" && game[place].isInBonus && html`<span class="bonus">Bonus</span>`;

/**
 * @param {Game} game
 * @param {"away" | "home"} place
 */
function renderFaceOffSide(game, place) {
  const side = game[place];
  const isLost = findLoser(game) === place;
  return html`<div class="faceoff-side ${place}${isLost ? " lost" : ""}">
    ${renderClub(side.team, { seed: side.seed })}
    <span class="faceoff-record tabular">${describeRecord(side.team)}</span>
    ${renderBonus(game, place)}
  </div>`;
}

/** @param {Game} game */
function renderFaceOffStatus(game) {
  const status = renderStatus(game);
  return status && html`<span class="faceoff-status">${status}</span>`;
}

// A game that has ended no longer says where it was on.
/** @param {Game} game */
const renderWhereToWatch = (game) => game.state !== "final" && renderNetworks(game.networks ?? []);

// The teams and the score hold one row, whatever shows under them: the game's status under the
// score, and where to watch.
/** @param {Game} game */
const renderFaceOff = (game) =>
  html`<div class="faceoff">
    ${renderFaceOffSide(game, "away")}
    <div class="faceoff-score">${renderHeadline(game)}</div>
    ${renderFaceOffSide(game, "home")} ${renderFaceOffStatus(game)} ${renderWhereToWatch(game)}
  </div>`;

/** @param {ShownGame} opened */
const isLoading = (opened) => !opened.details && !opened.error;

/**
 * @param {ShownGame} opened
 * @param {Game} game
 */
function renderDetails(opened, game) {
  const teams = { away: game.away.team, home: game.home.team };
  if (opened.kind === "preview") {
    const meetings = opened.details?.meetings ?? null;
    return renderPreview({
      teams,
      season: session.season,
      meetings,
      isLoading: isLoading(opened),
      isSeriesOver: game.round != null,
    });
  }
  if (opened.error?.status === 404)
    return renderSheetMessage("The league hasn't posted a box score for this game yet");
  if (opened.error) return renderRetryBlock("box score", classifyReadFailure(opened.error));
  return opened.details
    ? renderBoxScore(opened.details, opened, isGameToday(game, Date.now()))
    : renderPendingBoxScore(teams, opened);
}

/** @param {Game} game */
const loadHighlights = (game) => () =>
  fetchHighlights({
    id: game.id,
    away: /** @type {string} */ (game.away.team),
    home: /** @type {string} */ (game.home.team),
    start: /** @type {string} */ (game.start),
  });

// ESPN's clips don't say when in the game they came.
const describePlay = () => [];

// A game that's over offers its highlights beside its box score under pills, and any other game
// shows its box score or preview alone.
/** @param {Game} game */
function offerHighlights(game) {
  const isOver = game.state === "final" && Boolean(game.start);
  const tabs = /** @type {HTMLElement} */ (findSheet().querySelector(".sheet-top .pager-tabs"));
  tabs.hidden = !isOver;
  findElement("gameTabHighlights").hidden = !isOver;
  if (isOver) highlights?.show(game.id, loadHighlights(game));
  else if (sections?.readShown() === "highlights") sections.showSection("game", true);
}

// The league marks a game it put off or called off in its status, and keeps it as one to come.
/** @param {Game} game */
const isOver = (game) => game.state === "final" || /postpon|ppd|cancel/i.test(game.status);

/** @param {Game} game */
function noteGame(game) {
  noteShownGame(findSheet(), {
    key: game.id,
    isPlayingToday:
      game.state === "live" || (game.state === "pre" && isGameToday(game, Date.now())),
    isOver: isOver(game),
  });
}

function renderSheet() {
  const game = shown && findGame(shown.id);
  if (!game) return;
  noteGame(game);
  offerHighlights(game);
  const body = findElement("gameBody");
  findElement("gameTitle").textContent = nameGame(game);
  setHtml(findElement("gameWhen"), renderWhen(game));
  setHtml(findElement("gameFaceOff"), renderFaceOff(game));
  body.setAttribute("style", formatSheetColors(game.away.team, game.home.team));
  setHtml(body, renderDetails(shown, game));
  body.setAttribute("aria-busy", String(isLoading(shown)));
}

/** @param {Game} game */
const loadDetails = (game) =>
  chooseKind(game) === "box"
    ? fetchBoxScore(game.id)
    : fetchPreview({ season: session.year, away: game.away.team, home: game.home.team });

/** @param {ShownGame} opened */
const isLiveBoxScore = (opened) => opened.kind === "box" && findGame(opened.id)?.state === "live";

/** @param {Game} game */
const loadLead = (game) =>
  fetchLead({
    id: game.id,
    away: /** @type {string} */ (game.away.team),
    home: /** @type {string} */ (game.home.team),
    start: /** @type {string} */ (game.start),
  });

/**
 * @param {Game} game
 * @param {"box" | "preview"} kind
 */
const hasLead = (game, kind) => kind === "box" && Boolean(game.start);

// The lead comes from ESPN, beside the league's box score, so the box score never waits on it, and
// a read that fails keeps the chart already showing, or none.
/**
 * @param {ShownGame} opened
 * @param {Game} game
 */
async function refreshLead(opened, game) {
  if (!hasLead(game, opened.kind)) return;
  try {
    const lead = await loadLead(game);
    if (shown !== opened) return;
    opened.lead = lead;
  } catch {
    if (shown !== opened) return;
  }
  opened.isLeadLoading = false;
  renderSheet();
}

/** @param {any} boxScore */
const countPoints = (boxScore) => boxScore.away.score + boxScore.home.score;

/**
 * Whether a pushed box score is from before the one the sheet shows, as one the store saved before
 * the sheet's own read is: points only ever add up.
 * @param {any} pushed
 * @param {any} current
 */
export const isEarlierBoxScore = (pushed, current) =>
  !!current && countPoints(pushed) < countPoints(current);

/**
 * Takes the box score and lead the Worker read for the open game, unless it's from before the one
 * the sheet shows.
 * @param {ShownGame} opened
 * @param {{ boxScore: any, lead: any }} pushed
 */
function applyPushedDetails(opened, { boxScore, lead }) {
  if (shown !== opened || !boxScore || isEarlierBoxScore(boxScore, opened.details)) return;
  opened.details = boxScore;
  opened.error = null;
  if (lead) Object.assign(opened, { lead, isLeadLoading: false });
  renderSheet();
}

function stopWatchingDetails() {
  unwatchDetails?.();
  unwatchDetails = null;
}

// While a live game's box score is open, the Worker reads it and its lead with each update, and
// pushes them to the page.
/** @param {ShownGame} opened */
function watchLiveDetails(opened) {
  stopWatchingDetails();
  unwatchDetails = session.db.doc(`games/${opened.id}`).onSnapshot((snapshot) => {
    if (snapshot.exists) applyPushedDetails(opened, snapshot.data());
  });
}

// A read that fails keeps the box score already showing.
async function refreshDetails() {
  const opened = shown;
  const game = findGame(opened.id);
  if (!game) return;
  refreshLead(opened, game);
  try {
    const details = await loadDetails(game);
    if (shown !== opened) return;
    opened.details = details;
    opened.error = null;
  } catch (error) {
    if (shown !== opened) return;
    if (!opened.details) opened.error = error;
  }
  renderSheet();
  if (isLiveBoxScore(opened)) watchLiveDetails(opened);
}

/** @param {string} id */
function showGame(id) {
  const game = findGame(id);
  const kind = chooseKind(game);
  shown = { id, kind, details: null, error: null, lead: null, isLeadLoading: hasLead(game, kind) };
  stopWatchingDetails();
  renderSheet();
  refreshDetails();
}

const readShownGame = () =>
  shown && {
    id: shown.id,
    kind: shown.kind,
    details: shown.details,
    lead: shown.lead,
    isLeadLoading: shown.isLeadLoading,
    section: sections?.readShown() ?? null,
    highlights: highlights?.read() ?? null,
  };

/**
 * Shows the highlights and the section a reload kept, for the game the sheet shows.
 * @param {any} saved
 * @param {Game} game
 */
function reopenHighlights(saved, game) {
  const kept = saved.highlights;
  if (kept?.id === game.id && kept.highlights)
    highlights?.show(game.id, loadHighlights(game), kept.highlights);
}

// A game that has started since the sheet showed its preview shows its box score instead.
/** @param {(Omit<ShownGame, "error"> & { section?: unknown, highlights?: any }) | null} saved */
function reopenGameSheet(saved) {
  const game = saved && findGame(saved.id);
  if (!game) return false;
  reopenHighlights(saved, game);
  if (chooseKind(game) !== saved.kind) {
    showGame(game.id);
    return true;
  }
  const { id, kind, details, lead, isLeadLoading } = saved;
  shown = { id, kind, details, lead, isLeadLoading, error: null };
  renderSheet();
  if (typeof saved.section === "string") sections?.showSection(saved.section, true);
  refreshDetails();
  return true;
}

// A box score that didn't load, or a preview whose meetings didn't, shows its placeholders while
// it reads again.
function retryDetails() {
  if (!shown || isLoading(shown)) return;
  const isPreviewMissingMeetings = shown.kind === "preview" && !shown.details?.meetings;
  if (!shown.error && !isPreviewMissingMeetings) return;
  Object.assign(shown, { details: null, error: null });
  renderSheet();
  refreshDetails();
}

/**
 * @param {string} id
 * @param {string} [section] the section to open on, or its first
 */
function openGameSheet(id, section) {
  if (!findGame(id)) return;
  openSheet(findSheet(), {
    key: id,
    show: () => {
      highlights?.forget();
      showGame(id);
      if (section) sections?.showSection(section, true);
      else sections?.showFirstSection();
    },
  });
}

/**
 * Opens a game's sheet on one of its sections, as a search does.
 * @param {string} id
 * @param {string} section
 */
export const openGameSection = (id, section) => openGameSheet(id, section);

/**
 * Redraws the open sheet from the season as the store has it now. A game that started since the
 * sheet opened switches from its preview to its box score.
 */
export function refreshGameSheet() {
  const game = shown && findGame(shown.id);
  if (!game) return;
  if (chooseKind(game) !== shown.kind) showGame(shown.id);
  else renderSheet();
}

/** @param {HTMLElement} button */
const findRowGame = (button) =>
  /** @type {HTMLElement} */ (button.closest("[data-game]")).dataset.game;

/** @param {HTMLElement} button */
const openFromRow = (button) => openGameSheet(findRowGame(button));

/** @param {HTMLElement} button */
function prepareFromRow(button) {
  const game = findGame(findRowGame(button));
  if (game) loadDetails(game).catch(() => {});
}

function forgetGame() {
  letGoOfGame(findSheet());
  shown = null;
  highlights?.forget();
  stopWatchingDetails();
}

function retryHighlights() {
  const game = shown && findGame(shown.id);
  if (game) highlights?.retry(loadHighlights(game));
}

export function startGameSheet() {
  sections = wireSheetSections(findSheet());
  highlights = createHighlightsSection(findElement("highlightsBody"), describePlay);
  watchRetries(findSheet(), () => {
    retryDetails();
    retryHighlights();
  });
  for (const holder of ["seasonGames", "gameSearch", "updates", "teamBody"])
    watchGameOpens(findElement(holder), { open: openFromRow, prepare: prepareFromRow });
  wireSheet(findSheet(), {
    closeButton: findElement("gameCloseBtn"),
    backButton: findElement("gameBackBtn"),
    findScroller: sections.findShownSection,
    keeper: { read: readShownGame, reopen: reopenGameSheet },
    name: "Game",
    forget: forgetGame,
  });
}
