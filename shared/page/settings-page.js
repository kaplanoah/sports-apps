import { html, setHtml } from "./html.js";
import { openSheet, wireSheet } from "./sheet.js";
import { closeSheet } from "./sheet-swipe.js";
import { keepDialogFor } from "./sheet-memory.js";

/* global START_AFTER_AWAY_MS -- from long-away.js */

// Phosphor's caret-right and arrow-left, at their Light weight.
export const SETTINGS_CARET = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M180.24,132.24l-80,80a6,6,0,0,1-8.48-8.48L167.51,128,91.76,52.24a6,6,0,0,1,8.48-8.48l80,80A6,6,0,0,1,180.24,132.24Z"/></svg>`;
export const SETTINGS_BACK = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M222,128a6,6,0,0,1-6,6H54.49l61.75,61.76a6,6,0,1,1-8.48,8.48l-72-72a6,6,0,0,1,0-8.48l72-72a6,6,0,0,1,8.48,8.48L54.49,122H216A6,6,0,0,1,222,128Z"/></svg>`;

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
