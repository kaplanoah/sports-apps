import { html, setHtml } from "./html.js";
import { openSheet, wireSheet } from "./sheet.js";
import { closeSheet } from "./sheet-swipe.js";
import { keepDialogFor } from "./sheet-memory.js";
import { SETTINGS_CARET, SETTINGS_BACK } from "./settings-icons.js";

/* global START_AFTER_AWAY_MS -- from long-away.js */

/** @param {HTMLDialogElement} dialog @param {{ button: HTMLElement, isOwnGesture?: (target: EventTarget) => boolean }} options */
export function startSettingsPage(dialog, { button, isOwnGesture }) {
  const title = /** @type {HTMLElement} */ (dialog.querySelector("h2"));
  const back = /** @type {HTMLButtonElement} */ (dialog.querySelector(".settings-back"));
  setHtml(button, html`${button.textContent.trim()}${SETTINGS_CARET}`);
  setHtml(back, SETTINGS_BACK);
  button.addEventListener("click", () => {
    openSheet(dialog);
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  });
  back.addEventListener("click", () => closeSheet(dialog));
  dialog.addEventListener("close", () => button.focus());
  wireSheet(dialog, { name: title.textContent, isOwnGesture });
  keepDialogFor(dialog, START_AFTER_AWAY_MS);
}
