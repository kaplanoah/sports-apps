// The Updates box: each playoff game finished since this device first opened the app or last
// dismissed the box, with where its series stood after it, each opening the game's sheet, and the
// release notes it still shows.
// Nobody signs in, and people share the page's address, so each device keeps its own dismissal,
// and only phones and tablets show the box, only for the current season.

import { countDaysBetween } from "#shared/days.js";
import { isTouchDevice } from "#shared/device.js";
import { createViewerChoice } from "#shared/device-storage.js";
import {
  dismissNotes,
  listNotesToShow,
  readOrStartSeenAt,
  showUpdates,
  watchNoteDismissals,
} from "#shared/updates.js";
import { renderTeamName } from "./clubs.js";
import { readGameDay } from "./days.js";
import { renderGameOpenButton } from "./games-view.js";
import { RELEASE_NOTES } from "./release-notes.js";
import { isPastSeason, session } from "./session.js";
import { describeWin, isPlayoffFinal } from "./win-text.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {{ at: number, foundAt: number, day: Date | null, endedNextDay: boolean, text: import("#shared/html.js").Markup, action: import("#shared/html.js").Markup | false }} PlayoffWin */

// Null until this device's first look, which keeps its start.
const seenAt = createViewerChoice("updatesSeenAt", (stored) =>
  typeof stored === "number" && stored >= 0 ? stored : null,
);

// The feeds give no time a game ended but the Worker's first sight of it final, so a game found
// final without being seen live goes by its start.
/** @param {Game} game */
const readFinishedAt = (game) => Date.parse(game.end ?? game.start ?? "");

// Freshness goes by when the Worker first found a game final, which only moves forward, where a
// game's end can come before that of a final already listed. A final saved before the Worker kept
// that goes by when it finished.
/** @param {Game} game */
const readFoundAt = (game) => (game.finalAt ? Date.parse(game.finalAt) : readFinishedAt(game));

/**
 * @param {Game} game
 * @param {Game[]} games the season's games
 * @returns {PlayoffWin}
 */
function describePlayoffWin(game, games) {
  const at = readFinishedAt(game);
  const day = readGameDay(game);
  return {
    at,
    foundAt: readFoundAt(game),
    day,
    endedNextDay: !!day && countDaysBetween(day, new Date(at)) > 0,
    text: describeWin(game, games, renderTeamName),
    action: renderGameOpenButton(game),
  };
}

/**
 * Every playoff game the season has finished, newest first.
 * @param {{ games?: Game[] } | null} season
 * @returns {PlayoffWin[]}
 */
export function listPlayoffWins(season) {
  const games = season?.games ?? [];
  return games
    .filter((game) => isPlayoffFinal(game) && Number.isFinite(readFinishedAt(game)))
    .map((game) => describePlayoffWin(game, games))
    .sort((first, second) => second.at - first.at);
}

const findPanel = () => /** @type {HTMLElement} */ (document.getElementById("updates"));

/**
 * The playoff games finished since this device first opened the app or last dismissed the box,
 * newest first.
 */
export function listFreshUpdates() {
  if (!session.season) return [];
  const wins = listPlayoffWins(session.season);
  const freshAfter = readOrStartSeenAt(
    seenAt.read(),
    wins.map((win) => win.foundAt),
    seenAt.keep,
  );
  return wins.filter((win) => win.foundAt > freshAfter);
}

// The newest update's time is the Worker's, so the dismissal doesn't depend on this device's clock.
function dismissUpdates() {
  const times = listFreshUpdates().map((win) => win.foundAt);
  if (times.length) seenAt.keep(Math.max(...times));
  dismissNotes(RELEASE_NOTES);
  drawUpdates();
}

/**
 * Calls `onChange` whenever another tab dismisses the box.
 * @param {() => void} onChange
 */
export function watchDismissals(onChange) {
  seenAt.watch(onChange);
  watchNoteDismissals(onChange);
}

export function drawUpdates() {
  const isShown = isTouchDevice() && !isPastSeason();
  showUpdates(findPanel(), isShown ? listFreshUpdates() : [], {
    dismiss: dismissUpdates,
    notes: isShown ? listNotesToShow(RELEASE_NOTES) : [],
  });
}
