// How long a sheet stays open while the page is off the screen. The page decides as it comes back,
// before it draws, so the app opens on a sheet still there or already gone, never closing one in
// view. A sheet stays six hours, unless its dialog keeps it for less, as settings do. A game's
// sheet showing a game on today, or under way, stays until an hour after its end shows on the
// screen, however long that takes, while it's the sheet on top.

import { listOpenDialogs } from "./sheet.js";

const SHEET_KEPT_MS = 6 * 60 * 60 * 1000;
const GAME_KEPT_AFTER_END_MS = 60 * 60 * 1000;

/**
 * A game a sheet showed on its day or under way, by its key, whether it has ended, or won't be
 * played, and when the page first showed that on the screen.
 * @typedef {{ key: string, isOver: boolean, endSeenAt: number | null }} HeldGame
 */

/** @type {WeakMap<HTMLElement, number>} */
const keptForMs = new WeakMap();
/** @type {WeakMap<HTMLElement, HeldGame>} */
const heldGames = new WeakMap();

/**
 * Keeps a dialog open off the screen for `ms` rather than six hours.
 * @param {HTMLDialogElement} dialog
 * @param {number} ms
 */
export function keepDialogFor(dialog, ms) {
  keptForMs.set(dialog, ms);
}

/** The sheet each open dialog shows, with its dialog. */
const listShownSheets = () =>
  listOpenDialogs().map(({ dialog, sheets, shown }) => ({
    dialog,
    sheet: sheets[shown] ?? dialog,
  }));

/** @param {HTMLElement} sheet */
const isShownSheet = (sheet) => listShownSheets().some((shown) => shown.sheet === sheet);

/**
 * @param {HeldGame | undefined} held
 * @param {number} at
 */
function noteEndSeen(held, at) {
  if (held?.isOver && held.endSeenAt === null) held.endSeenAt = at;
}

/**
 * Notes the game a sheet shows each time it draws: its key, whether it's on today or under way,
 * and whether it has ended or won't be played. The sheet holds a game it showed on its day until
 * an hour after its end shows on the screen.
 * @param {HTMLElement} sheet
 * @param {{ key: string, isPlayingToday: boolean, isOver: boolean }} game
 */
export function noteShownGame(sheet, { key, isPlayingToday, isOver }) {
  const known = heldGames.get(sheet);
  const held =
    known?.key === key ? known : isPlayingToday ? { key, isOver, endSeenAt: null } : null;
  if (!held) {
    heldGames.delete(sheet);
    return;
  }
  heldGames.set(sheet, held);
  held.isOver = isOver;
  if (!isOver) held.endSeenAt = null;
  if (!document.hidden && isShownSheet(sheet)) noteEndSeen(held, Date.now());
}

/** @param {HTMLElement} sheet */
export function letGoOfGame(sheet) {
  heldGames.delete(sheet);
}

/**
 * Notes the end of each game a shown sheet holds as seen at `at`, unless it already was.
 * @param {number} at
 */
export function noteShownEndsSeen(at) {
  for (const { sheet } of listShownSheets()) noteEndSeen(heldGames.get(sheet), at);
}

/**
 * @param {HTMLElement} sheet
 * @returns {HeldGame | null}
 */
export const readHeldGame = (sheet) => {
  const held = heldGames.get(sheet);
  return held ? { ...held } : null;
};

/** @param {unknown} saved */
const isHeldGame = (saved) => {
  const held = /** @type {HeldGame | null} */ (saved);
  return (
    typeof held?.key === "string" &&
    typeof held.isOver === "boolean" &&
    (held.endSeenAt === null || typeof held.endSeenAt === "number")
  );
};

/**
 * Has a sheet the page put back hold again the game it held as the page left the screen.
 * @param {HTMLElement} sheet
 * @param {unknown} saved what readHeldGame read then
 */
export function restoreHeldGame(sheet, saved) {
  if (isHeldGame(saved)) heldGames.set(sheet, { .../** @type {HeldGame} */ (saved) });
  else heldGames.delete(sheet);
}

/**
 * When a dialog the page left at `leftAt` closes, or null while it holds a game whose end hasn't
 * shown yet.
 * @param {HTMLDialogElement} dialog
 * @param {HTMLElement} shownSheet
 * @param {number} leftAt
 * @returns {number | null}
 */
export function findForgetAt(dialog, shownSheet, leftAt) {
  const held = heldGames.get(shownSheet);
  if (!held) return leftAt + (keptForMs.get(dialog) ?? SHEET_KEPT_MS);
  return held.endSeenAt === null ? null : held.endSeenAt + GAME_KEPT_AFTER_END_MS;
}

/**
 * Closes each dialog kept open longer than it stays, as the page comes back to the screen.
 * @param {number} leftAt when the page left the screen
 */
export function closeForgottenDialogs(leftAt) {
  const now = Date.now();
  for (const { dialog, sheet } of listShownSheets()) {
    const forgetAt = findForgetAt(dialog, sheet, leftAt);
    if (forgetAt !== null && now >= forgetAt) dialog.close();
  }
}
