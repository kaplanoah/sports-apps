// The sheets a page shows, listed as it leaves the screen, and taken back on its next load: the
// page puts them back open before its first paint (show-last-drawn.js), and once its modules
// load, each sheet's code shows again what it showed, beside the one it was opened from. A sheet
// with sections, like a game's Game and Highlights, also lists which pills it offered and where
// its shown section was scrolled, which the page puts back before its code loads. Each also lists
// when its dialog closes off the screen (sheet-memory.js), which the page checks before putting it
// back.

import {
  copySheet,
  findBackButton,
  findOriginal,
  listOpenDialogs,
  nameSheet,
  readSheetParts,
  readSubject,
  restoreStack,
} from "./sheet.js";
import { findForgetAt, readHeldGame, restoreHeldGame } from "./sheet-memory.js";

/**
 * A sheet's shown section, by its id, the pills the sheet offered, by theirs, and where the
 * section was scrolled.
 * @typedef {{ id: string, tabs: string[], top: number }} ShownSection
 */
/**
 * A sheet showing, or a copy of one, by its sheet's id, and the key it was opened with, with the
 * game it holds open and when its dialog closes, or null while that game hasn't shown its end.
 * @typedef {{ id: string, scrollTop: number, section: ShownSection | null, subject: unknown, showing: string | null, backLabel: string | null, heldGame: import("./sheet-memory.js").HeldGame | null, forgetAt: number | null }} OpenSheet
 */
/** @typedef {{ sheet: HTMLElement, subject: unknown, showing: unknown, scrollTop: unknown, heldGame: unknown }} SavedSheet */

/** @param {HTMLElement} sheet */
function readBackLabel(sheet) {
  const backButton = findBackButton(sheet);
  if (!backButton || backButton.hidden) return null;
  return backButton.querySelector(".sheet-back-label")?.textContent ?? null;
}

/**
 * @param {HTMLElement} sheet
 * @returns {ShownSection | null}
 */
function describeShownSection(sheet) {
  const section = sheet.querySelector(".sheet-sections > .sheet-section:not([inert])");
  const tabList = /** @type {HTMLElement | null} */ (
    sheet.querySelector(".sheet-top [role=tablist]")
  );
  if (!section || !tabList) return null;
  const tabs = tabList.hidden
    ? []
    : [.../** @type {NodeListOf<HTMLElement>} */ (tabList.querySelectorAll("[role=tab]"))].filter(
        (tab) => !tab.hidden,
      );
  return { id: section.id, tabs: tabs.map((tab) => tab.id), top: section.scrollTop };
}

/**
 * @param {HTMLElement} sheet
 * @param {number | null} forgetAt
 * @returns {OpenSheet}
 */
const describeOpenSheet = (sheet, forgetAt) => ({
  id: findOriginal(sheet).id,
  scrollTop: sheet.scrollTop,
  section: describeShownSection(sheet),
  subject: readSubject(sheet),
  showing: sheet.getAttribute("data-showing"),
  backLabel: readBackLabel(sheet),
  heldGame: readHeldGame(sheet),
  forgetAt,
});

/**
 * @param {{ dialog: HTMLDialogElement, sheets: HTMLElement[], shown: number }} open
 * @param {number} leftAt
 */
function describeShownSheets({ dialog, sheets, shown }, leftAt) {
  const shownSheets = sheets.length ? sheets.slice(0, shown + 1) : [dialog];
  const forgetAt = findForgetAt(dialog, shownSheets[shownSheets.length - 1], leftAt);
  return shownSheets.map((sheet) => describeOpenSheet(sheet, forgetAt));
}

/**
 * The sheets showing, each dialog's in the order they opened up to the one it shows, with where
 * each is scrolled, what it shows, what its back button calls the one before it, and when its
 * dialog closes for a page that left the screen at `leftAt`.
 * @param {number} [leftAt]
 * @returns {OpenSheet[]}
 */
export const listOpenSheets = (leftAt = Date.now()) =>
  listOpenDialogs().flatMap((open) => describeShownSheets(open, leftAt));

/**
 * Each sheet in each open dialog's row, in order, and whether it's the one its dialog shows.
 * @returns {{ id: string, isShown: boolean }[]}
 */
export const listSheetsInOpenDialogs = () =>
  listOpenDialogs().flatMap(({ dialog, sheets, shown }) =>
    sheets.length
      ? sheets.map((sheet, index) => ({ id: nameSheet(sheet), isShown: index === shown }))
      : [{ id: dialog.id, isShown: true }],
  );

// What an earlier release saved may not fit the sheet as it is now.
/** @param {SavedSheet} saved */
function reopenSheet({ sheet, subject, heldGame }) {
  restoreHeldGame(sheet, heldGame);
  const keeper = readSheetParts(sheet)?.keeper;
  if (!keeper) return true;
  try {
    return keeper.reopen(subject);
  } catch {
    return false;
  }
}

/**
 * Has the sheet show again what it showed, opened with the key it was, scrolled where it was.
 * @param {SavedSheet} saved
 */
function showAgain(saved) {
  const { sheet, showing, scrollTop } = saved;
  if (!reopenSheet(saved)) return false;
  if (typeof showing === "string") sheet.setAttribute("data-showing", showing);
  else sheet.removeAttribute("data-showing");
  sheet.scrollTop = Number(scrollTop) || 0;
  return true;
}

/**
 * The sheets that show again what they showed, up to the first that can't, each sheet the stack
 * held more than once leaving a copy wherever it was before.
 * @param {SavedSheet[]} saved
 */
function listReopened(saved) {
  /** @type {HTMLElement[]} */
  const reopened = [];
  for (const each of saved) {
    const index = reopened.indexOf(each.sheet);
    if (index >= 0) reopened[index] = copySheet(each.sheet);
    if (!showAgain(each)) break;
    reopened.push(each.sheet);
  }
  return reopened;
}

/**
 * Takes a dialog the page put back open as it loaded, with the sheets in its row that show again
 * what they showed, or closes it when none can.
 * @param {HTMLDialogElement} dialog
 * @param {SavedSheet[]} saved
 */
function reopenDialog(dialog, saved) {
  const reopened = listReopened(saved);
  if (!reopened.length) return dialog.close();
  restoreStack(dialog, reopened.includes(dialog) ? [] : reopened);
}

/** @param {unknown} sheet */
const isOpenSheet = (sheet) => typeof (/** @type {OpenSheet | null} */ (sheet)?.id) === "string";

/** @param {unknown} saved */
function groupByDialog(saved) {
  const isTaken = new Set(listOpenDialogs().map(({ dialog }) => dialog));
  /** @type {Map<HTMLDialogElement, SavedSheet[]>} */
  const groups = new Map();
  for (const { id, subject, showing, scrollTop, heldGame } of /** @type {OpenSheet[]} */ (
    Array.isArray(saved) ? saved.filter(isOpenSheet) : []
  )) {
    const sheet = document.getElementById(id);
    const dialog = sheet?.closest("dialog");
    if (!sheet || !dialog?.open || isTaken.has(dialog)) continue;
    groups.set(dialog, [
      ...(groups.get(dialog) ?? []),
      { sheet, subject, showing, scrollTop, heldGame },
    ]);
  }
  return groups;
}

/**
 * Takes over the sheets the page put back open as it loaded, each showing again what it showed
 * beside the one it was opened from, and closes a dialog none of whose sheets can.
 * @param {unknown} saved what listOpenSheets listed as the page last left the screen
 */
export function reopenSheets(saved) {
  for (const [dialog, sheets] of groupByDialog(saved)) reopenDialog(dialog, sheets);
}
