import { html, setHtml } from "./html.js";
import { openSheet, wireSheet } from "./sheet.js";
import { closeSheet } from "./sheet-swipe.js";
import { keepDialogFor } from "./sheet-memory.js";
import { SETTINGS_CARET, SETTINGS_BACK } from "./settings-icons.js";
import { runAfterPress } from "./press.js";

/* global START_AFTER_AWAY_MS -- from long-away.js */

/** @param {HTMLDialogElement} dialog @param {{ button: HTMLElement, isOwnGesture?: (target: EventTarget) => boolean }} options */
export function startSettingsPage(dialog, { button, isOwnGesture }) {
  const title = /** @type {HTMLElement} */ (dialog.querySelector("h2"));
  const back = /** @type {HTMLButtonElement} */ (dialog.querySelector(".settings-back"));
  setHtml(button, html`${button.textContent.trim()}${SETTINGS_CARET}`);
  setHtml(back, SETTINGS_BACK);
  const openPage = () => {
    openSheet(dialog);
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  };
  button.addEventListener("click", () => runAfterPress(button, openPage));
  back.addEventListener("click", () => runAfterPress(back, () => closeSheet(dialog)));
  dialog.addEventListener("close", () => button.focus());
  wireSheet(dialog, { name: title.textContent, isOwnGesture });
  keepDialogFor(dialog, START_AFTER_AWAY_MS);
}
