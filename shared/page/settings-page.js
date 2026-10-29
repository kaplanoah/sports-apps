import { html, setHtml } from "./html.js";
import { openSheet, wireSheet } from "./sheet.js";
import { closeSheet } from "./sheet-swipe.js";
import { keepDialogFor } from "./sheet-memory.js";
import { SETTINGS_CARET } from "./settings-icons.js";
import { runAfterPress } from "./press.js";

/* global START_AFTER_AWAY_MS -- from long-away.js */

/** @param {HTMLDialogElement} dialog */
export function focusSettingsTitle(dialog) {
  const title = /** @type {HTMLElement} */ (dialog.querySelector("h2"));
  title.tabIndex = -1;
  title.focus({ preventScroll: true });
  dialog.scrollTop = 0;
}

/** @param {HTMLDialogElement} dialog */
export function showSettingsPage(dialog) {
  openSheet(dialog);
  focusSettingsTitle(dialog);
}

/**
 * Whether focus has moved on to another sheet, as when a page opens while the last one closes.
 * @param {HTMLElement} button
 */
function isFocusOnAnotherSheet(button) {
  const focusedDialog = document.activeElement?.closest("dialog");
  return Boolean(focusedDialog?.open) && focusedDialog !== button.closest("dialog");
}

/**
 * Wires the row that opens a page of settings, with its caret, and the page's sheet, which hands
 * focus back to the row as it closes, unless another sheet has taken it.
 * @param {HTMLDialogElement} dialog
 * @param {{ button: HTMLElement, open: () => void } & import("./sheet.js").SheetParts} options
 */
export function wireSettingsPage(dialog, { button, open, ...sheet }) {
  setHtml(button, html`${button.textContent.trim()}${SETTINGS_CARET}`);
  button.addEventListener("click", open);
  dialog.addEventListener("close", () => {
    if (!isFocusOnAnotherSheet(button)) button.focus();
  });
  wireSheet(dialog, sheet);
  keepDialogFor(dialog, START_AFTER_AWAY_MS);
}

/**
 * Wires a page of settings that draws nothing of its own, its row, and its back arrow, and
 * returns what opens it.
 * @param {HTMLDialogElement} dialog
 * @param {{ button: HTMLElement, isOwnGesture?: (target: EventTarget) => boolean }} options
 */
export function startSettingsPage(dialog, { button, isOwnGesture }) {
  const back = /** @type {HTMLButtonElement} */ (dialog.querySelector(".settings-back"));
  const open = () => showSettingsPage(dialog);
  back.addEventListener("click", () => runAfterPress(back, () => closeSheet(dialog)));
  wireSettingsPage(dialog, {
    button,
    open,
    name: /** @type {HTMLElement} */ (dialog.querySelector("h2")).textContent,
    isOwnGesture,
  });
  return open;
}
