// A sheet a tap opens over the page: the whole screen on phones, rising from the bottom, and a
// modal on wider screens. A sheet is a page in a dialog.
//
// The stack: a dialog with a .sheet-row holds several sheets, one over another, like a game's, a
// team's, and a player's. A sheet opened from another slides in from the right beside it, the one
// under it moving out to the left, the row's gap between them, with a back arrow in place of its
// close caret, named after the one under it. The arrow, or a swipe right that the finger drags,
// slides it away, the one under it coming back in, and it leaves the stack and lets go of what it
// showed. Only the sheet on top is drawn at rest; the ones under it are hidden and inert. A sheet
// opened to show something new always comes in after the shown one, even when the stack already
// holds it: it leaves a copy in its place, a still picture of what it showed, and once the stack
// comes back to rest on the copy, the sheet takes back what the copy showed, scrolled where it was,
// and the copy goes. Only a tap on what the sheet under the shown one shows goes back to it. The
// caret, a click on the backdrop, Escape, and on phones a swipe down close the dialog
// (sheet-swipe.js). A page that loads again shows the sheets it showed before, where they were
// scrolled (show-last-drawn.js and sheet-reopen.js). The stack and a sheet's sections both move
// their panels with slide-panels.js.
//
// Three rules hold for every motion here, and for the tab bar and pager too:
// - Nothing asks for a layer ahead of time: the only will-change is on [data-dragged], which a
//   dialog carries only while a finger drags it down.
// - Nothing animates at rest: once a slide, a spring back, or a close ends,
//   document.getAnimations() holds nothing that plays over time, on the document's timeline, only
//   motions a scroll drives, like the season tab's header riding up with its part
//   (season-header.js), and nothing asks for an animation frame.
// - Nothing filters what is behind it: no backdrop-filter anywhere.

import { noteSheetStep } from "./sheet-log.js";
import { closeOnCancel, closeOnSwipeDown, closeSheet } from "./sheet-swipe.js";
import { createSlidePanels } from "./slide-panels.js";

/**
 * How a sheet's code tells what it shows, as a value JSON can hold, and shows it again on the
 * page's next load, saying whether it could.
 * @typedef {{ read: () => unknown, reopen: (subject: any) => boolean }} SheetKeeper
 */
/**
 * @typedef {object} SheetParts
 * @property {HTMLElement} closeButton
 * @property {HTMLElement} [backButton] shown in place of the close button when the sheet opened
 *   from another, with its `.sheet-back-label` naming that one
 * @property {(target: EventTarget) => boolean} [isOwnGesture] a touch on a target this claims,
 *   like a drag handle or a picker, never moves the sheet
 * @property {() => HTMLElement} [findScroller] what scrolls the content shown, when the sheet
 *   holds sections that each scroll on their own, like a team's Team and Roster
 * @property {SheetKeeper} [keeper]
 * @property {string} [name] what the back button of a sheet opened from it calls it
 * @property {() => void} [forget] lets go of what the sheet showed once it's no longer beside the
 *   others, or its dialog closes
 */
/**
 * What a sheet opens to show.
 * @typedef {object} SheetOpening
 * @property {string} key names it, like a team's code, so a tap on what the sheet under the shown
 *   one shows goes back there
 * @property {() => void} show draws it in the sheet
 */
/** @typedef {ReturnType<typeof createSlidePanels>} SlidePanels */
/** @typedef {{ path: number[], top: number, left: number }} ScrollSpot */
/**
 * A copy's sheet, what that showed as it was copied, and where it and each part of it were scrolled.
 * @typedef {{ sheet: HTMLElement, subject: unknown, scrolls: ScrollSpot[] }} SheetCopy
 */

/** @type {WeakMap<HTMLElement, SheetParts>} */
const sheetParts = new WeakMap();
// Each dialog's sheets, in the order they opened.
/** @type {WeakMap<HTMLDialogElement, HTMLElement[]>} */
const stacks = new WeakMap();
/** @type {WeakMap<HTMLDialogElement, SlidePanels>} */
const panelsByDialog = new WeakMap();
// In the order they opened.
/** @type {Set<HTMLDialogElement>} */
const openDialogs = new Set();
/** @type {WeakMap<HTMLElement, SheetCopy>} */
const copies = new WeakMap();

/** @param {HTMLElement} sheet */
const findDialog = (sheet) => /** @type {HTMLDialogElement} */ (sheet.closest("dialog"));

/** @param {HTMLDialogElement} dialog */
const findRow = (dialog) =>
  /** @type {HTMLElement | null} */ (dialog.querySelector(":scope > .sheet-row"));

/** @param {HTMLDialogElement} dialog */
const listStack = (dialog) => stacks.get(dialog) ?? [];

/** @param {HTMLDialogElement} dialog */
const readShownIndex = (dialog) => panelsByDialog.get(dialog)?.readShown() ?? 0;

/** @param {HTMLElement} sheet */
export const readSheetParts = (sheet) => sheetParts.get(sheet);

/**
 * The sheet a copy was made from, or the sheet itself.
 * @param {HTMLElement} sheet
 */
export const findOriginal = (sheet) => copies.get(sheet)?.sheet ?? sheet;

/**
 * What a sheet shows, as its keeper tells it, or what its copy held.
 * @param {HTMLElement} sheet
 */
export const readSubject = (sheet) =>
  copies.has(sheet) ? copies.get(sheet)?.subject : (sheetParts.get(sheet)?.keeper?.read() ?? null);

/**
 * A copy's own back button, which it holds as the sheet's was when it was copied.
 * @param {HTMLElement} sheet
 * @returns {HTMLElement | undefined}
 */
export const findBackButton = (sheet) =>
  copies.has(sheet)
    ? /** @type {HTMLElement} */ (sheet.querySelector(".sheet-back"))
    : sheetParts.get(sheet)?.backButton;

/**
 * The sheet's id, or its sheet's for a copy.
 * @param {HTMLElement} sheet
 */
export const nameSheet = (sheet) =>
  copies.has(sheet) ? `${findOriginal(sheet).id} copy` : sheet.id;

/** @param {HTMLDialogElement} dialog */
const findShownSheet = (dialog) => listStack(dialog)[readShownIndex(dialog)] ?? dialog;

/** @param {HTMLElement[]} sheets */
const listIds = (sheets) => sheets.map(nameSheet).join(", ");

/**
 * Each dialog that's open, with its sheets in the order they opened and the one it shows.
 * @returns {{ dialog: HTMLDialogElement, sheets: HTMLElement[], shown: number }[]}
 */
export const listOpenDialogs = () =>
  [...openDialogs]
    .filter((dialog) => dialog.open)
    .map((dialog) => ({ dialog, sheets: listStack(dialog), shown: readShownIndex(dialog) }));

/**
 * Where a sheet sits for the row's position: past the left edge, under the one on top, on top, or
 * past the right edge, waiting to come in.
 * @param {number} index
 * @param {number} position
 */
const placeSheet = (index, position) => Math.max(-1, Math.min(index - position, 1));

/**
 * @param {HTMLElement | undefined} button
 * @param {HTMLElement | undefined} before the sheet it steps back to, if any
 */
function labelBackButton(button, before) {
  if (!button) return;
  button.hidden = !before;
  if (!before) return;
  const name = sheetParts.get(findOriginal(before))?.name ?? "Back";
  const label = button.querySelector(".sheet-back-label");
  if (label) label.textContent = name;
  button.setAttribute("aria-label", `Back to ${name}`);
}

/** @param {HTMLDialogElement} dialog */
function placeRow(dialog) {
  const row = findRow(dialog);
  if (!row) return;
  const sheets = listStack(dialog);
  for (const sheet of /** @type {HTMLElement[]} */ ([...row.children])) {
    const index = sheets.indexOf(sheet);
    sheet.hidden = index < 0;
    sheet.style.zIndex = index < 0 ? "" : String(index);
    labelBackButton(findBackButton(sheet), sheets[index - 1]);
  }
}

/** @param {HTMLElement} sheet */
const forgetSheet = (sheet) => sheetParts.get(sheet)?.forget?.();

/**
 * Takes a sheet out of the row's stack, or a copy out of the row.
 * @param {HTMLElement} sheet
 */
function letGoOf(sheet) {
  if (copies.has(sheet)) return sheet.remove();
  sheet.hidden = true;
  sheet.style.transform = "";
  forgetSheet(sheet);
}

/**
 * Where `element` sits under `ancestor`, by child indexes.
 * @param {Element} ancestor
 * @param {Element} element
 */
function findPath(ancestor, element) {
  /** @type {number[]} */
  const path = [];
  for (let child = element; child !== ancestor && child.parentElement;) {
    path.unshift([...child.parentElement.children].indexOf(child));
    child = child.parentElement;
  }
  return path;
}

/**
 * Where the sheet, and each part of it that scrolls, is scrolled.
 * @param {HTMLElement} sheet
 * @returns {ScrollSpot[]}
 */
const listScrolls = (sheet) =>
  [sheet, ...sheet.querySelectorAll("*")]
    .filter((element) => element.scrollTop || element.scrollLeft)
    .map((element) => ({
      path: findPath(sheet, element),
      top: element.scrollTop,
      left: element.scrollLeft,
    }));

/**
 * @param {HTMLElement} sheet
 * @param {ScrollSpot[]} scrolls
 */
function restoreScrolls(sheet, scrolls) {
  for (const { path, top, left } of scrolls) {
    /** @type {Element | undefined} */
    const element = path.reduce(
      (/** @type {Element | undefined} */ parent, index) => parent?.children[index],
      sheet,
    );
    if (element) Object.assign(element, { scrollTop: top, scrollLeft: left });
  }
}

/**
 * Puts a copy of the sheet beside it in the row: a still picture of what it shows, scrolled where
 * it is. A copy keeps none of the sheet's ids, which stay the sheet's own, and isn't a part the page
 * draws whole.
 * @param {HTMLElement} sheet
 */
export function copySheet(sheet) {
  const copy = /** @type {HTMLElement} */ (sheet.cloneNode(true));
  for (const element of [copy, ...copy.querySelectorAll("[id], [data-last-drawn]")]) {
    element.removeAttribute("id");
    element.removeAttribute("data-last-drawn");
  }
  const scrolls = listScrolls(sheet);
  sheet.before(copy);
  restoreScrolls(copy, scrolls);
  copies.set(copy, { sheet, subject: readSubject(sheet), scrolls });
  return copy;
}

// What a copy showed may be gone, like a game from a season the page no longer shows; the copy then
// stays as it is.
/** @param {HTMLDialogElement} dialog */
function takeBackFromCopy(dialog) {
  const sheets = listStack(dialog);
  const index = readShownIndex(dialog);
  const copy = sheets[index];
  const held = copies.get(copy);
  if (!held || !sheetParts.get(held.sheet)?.keeper?.reopen(held.subject)) return;
  const { sheet } = held;
  sheets[index] = sheet;
  copyShowing(copy, sheet);
  sheet.hidden = false;
  sheet.inert = false;
  restoreScrolls(sheet, held.scrolls);
  copy.remove();
  noteSheetStep(`take back ${sheet.id} from its copy`);
}

/**
 * Takes every sheet after the shown one out of the stack, but `kept`.
 * @param {HTMLDialogElement} dialog
 * @param {HTMLElement} [kept]
 */
function dropSheetsAhead(dialog, kept) {
  const sheets = listStack(dialog);
  const dropped = sheets.splice(readShownIndex(dialog) + 1).filter((sheet) => sheet !== kept);
  if (!dropped.length) return;
  for (const sheet of dropped) letGoOf(sheet);
  noteSheetStep(`let go of ${listIds(dropped)}`);
}

// A sheet a finger or a button brought into view is the one the keyboard and screen readers are
// in, and is named by the dialog.
/** @param {HTMLDialogElement} dialog */
function focusShownSheet(dialog) {
  const sheet = findShownSheet(dialog);
  const title = sheet.getAttribute("aria-labelledby");
  if (title) dialog.setAttribute("aria-labelledby", title);
  if (!sheet.contains(document.activeElement)) sheet.focus({ preventScroll: true });
}

/** @param {HTMLDialogElement} dialog */
function settleOnShown(dialog) {
  if (!dialog.open) return;
  dropSheetsAhead(dialog);
  takeBackFromCopy(dialog);
  placeRow(dialog);
  focusShownSheet(dialog);
  noteSheetStep(`settle on ${nameSheet(findShownSheet(dialog))}`);
}

/**
 * How far down the row two sheets' bands both reach, as far as each still shows.
 * @param {HTMLElement} row
 * @param {(HTMLElement | undefined)[]} sheets
 */
function measureSharedBand(row, sheets) {
  const rowTop = row.getBoundingClientRect().top;
  const reaches = sheets.map((sheet) => {
    const top = sheet?.querySelector(".sheet-top");
    return top ? top.getBoundingClientRect().bottom - rowTop : 0;
  });
  return Math.max(0, Math.min(...reaches));
}

// A slide a tap starts carries two sheets as one, so the row fills the gap between their bands down
// to where the shorter one ends, as sheet.css draws it from --sheet-band-joined.
/**
 * @param {HTMLDialogElement} dialog
 * @param {(HTMLElement | undefined)[]} sheets
 */
function joinBands(dialog, sheets) {
  const row = findRow(dialog);
  if (row) row.style.setProperty("--sheet-band-joined", `${measureSharedBand(row, sheets)}px`);
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {number} index
 */
function slideToSheet(dialog, index) {
  const sheets = listStack(dialog);
  noteSheetStep(`slide to ${nameSheet(sheets[index])}`);
  joinBands(dialog, [sheets[readShownIndex(dialog)], sheets[index]]);
  panelsByDialog.get(dialog)?.slideTo(index);
}

/**
 * Shows the dialog's stack at rest on its last sheet, as when it opens.
 * @param {HTMLDialogElement} dialog
 * @param {HTMLElement[]} sheets
 */
export function restoreStack(dialog, sheets) {
  stacks.set(dialog, sheets);
  openDialogs.add(dialog);
  placeRow(dialog);
  panelsByDialog.get(dialog)?.jumpTo(Math.max(sheets.length - 1, 0));
}

/**
 * @param {HTMLElement} from
 * @param {HTMLElement} to
 */
function copyShowing(from, to) {
  const key = from.getAttribute("data-showing");
  if (key === null) to.removeAttribute("data-showing");
  else to.setAttribute("data-showing", key);
}

/**
 * Whether a sheet in the stack, or a copy, shows what an opening would.
 * @param {HTMLElement | undefined} shown
 * @param {HTMLElement} sheet
 * @param {SheetOpening} [opening]
 */
const isShowing = (shown, sheet, opening) =>
  !!shown &&
  findOriginal(shown) === sheet &&
  shown.getAttribute("data-showing") === (opening?.key ?? null);

/**
 * @param {HTMLElement} sheet
 * @param {SheetOpening} [opening]
 */
function showIn(sheet, opening) {
  if (!opening) return;
  opening.show();
  sheet.setAttribute("data-showing", opening.key);
}

/**
 * Brings a sheet into the open dialog after the shown one, in place of any after it, sliding in
 * from the right edge, or from where it was as it slid away, leaving a copy wherever the stack
 * still holds it, or slides back to the sheet under the shown one when that shows the same.
 * @param {HTMLDialogElement} dialog
 * @param {HTMLElement} sheet
 * @param {SheetOpening} [opening]
 */
function showOver(dialog, sheet, opening) {
  const sheets = listStack(dialog);
  const shown = readShownIndex(dialog);
  if (isShowing(sheets[shown - 1], sheet, opening)) return slideToSheet(dialog, shown - 1);
  panelsByDialog.get(dialog)?.hold();
  const index = sheets.indexOf(sheet);
  dropSheetsAhead(dialog, sheet);
  if (index >= 0 && index <= shown) sheets[index] = copySheet(sheet);
  if (index <= shown) sheet.style.transform = "translateX(100%)";
  showIn(sheet, opening);
  sheet.scrollTop = 0;
  sheets.push(sheet);
  placeRow(dialog);
  slideToSheet(dialog, sheets.length - 1);
}

/**
 * Shows a sheet, opening its dialog or over the dialog's shown sheet, or keeps it showing,
 * scrolled back to its top, when it already shows the same or is its dialog.
 * @param {HTMLElement} sheet
 * @param {SheetOpening} [opening] what to show, unless the sheet shows one thing, like settings
 */
export function openSheet(sheet, opening) {
  const dialog = findDialog(sheet);
  if (sheet !== dialog)
    noteSheetStep(
      `open ${sheet.id} over ${dialog.open ? nameSheet(findShownSheet(dialog)) : "the page"}`,
    );
  if (dialog.open && sheet !== dialog && !isShowing(findShownSheet(dialog), sheet, opening))
    return showOver(dialog, sheet, opening);
  showIn(sheet, opening);
  if (!dialog.open) {
    dialog.showModal();
    restoreStack(dialog, sheet === dialog ? [] : [sheet]);
  }
  sheet.scrollTop = 0;
}

/** @param {HTMLElement} sheet */
function stepBack(sheet) {
  const dialog = findDialog(sheet);
  const index = listStack(dialog).indexOf(sheet);
  if (index > 0) slideToSheet(dialog, index - 1);
}

/** @param {HTMLDialogElement} dialog */
function forgetDialog(dialog) {
  const sheets = listStack(dialog);
  panelsByDialog.get(dialog)?.hold();
  stacks.delete(dialog);
  openDialogs.delete(dialog);
  dialog.removeAttribute("data-reopened");
  for (const sheet of sheets) letGoOf(sheet);
  if (sheets.length === 0) forgetSheet(dialog);
  placeRow(dialog);
}

// A click on the backdrop lands on the dialog itself; its content fills it edge to edge.
/** @param {HTMLDialogElement} dialog */
function closeOnBackdropClick(dialog) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSheet(dialog);
  });
}

/** @param {HTMLDialogElement} dialog */
function wireStack(dialog) {
  const row = findRow(dialog);
  if (!row) return;
  const panels = createSlidePanels(row, {
    listPanels: () => listStack(dialog),
    place: placeSheet,
    canGo: (direction) => direction < 0 && readShownIndex(dialog) > 0,
    onSettle: () => settleOnShown(dialog),
  });
  panelsByDialog.set(dialog, panels);
}

/** @type {WeakSet<HTMLDialogElement>} */
const wiredDialogs = new WeakSet();

/** @param {HTMLDialogElement} dialog */
function wireDialog(dialog) {
  if (wiredDialogs.has(dialog)) return;
  wiredDialogs.add(dialog);
  closeOnBackdropClick(dialog);
  closeOnCancel(dialog);
  dialog.addEventListener("close", () => forgetDialog(dialog));
  /** @param {HTMLElement} sheet */
  const readParts = (sheet) => sheetParts.get(sheet);
  closeOnSwipeDown(dialog, {
    isOwnGesture: (target) => readParts(findShownSheet(dialog))?.isOwnGesture?.(target) ?? false,
    findScroller: () => {
      const sheet = findShownSheet(dialog);
      return readParts(sheet)?.findScroller?.() ?? sheet;
    },
  });
  wireStack(dialog);
}

/**
 * Wires a sheet's ways to close its dialog and to step between sheets, and with a `keeper`, its
 * showing again on the page's next load.
 * @param {HTMLElement} sheet the dialog itself, or one of the sheets in its row
 * @param {SheetParts} parts
 */
export function wireSheet(sheet, parts) {
  sheetParts.set(sheet, parts);
  const dialog = findDialog(sheet);
  if (sheet !== dialog) sheet.tabIndex = -1;
  parts.closeButton.addEventListener("click", () => closeSheet(dialog));
  parts.backButton?.addEventListener("click", () => stepBack(sheet));
  wireDialog(dialog);
}
