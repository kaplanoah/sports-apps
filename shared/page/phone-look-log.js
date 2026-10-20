// Every page that loads this runs pick-theme.js first.
/* global readPhoneLook -- from pick-theme.js */

import { createStepLog } from "./step-log.js";

// Each change the phone reports of its light or dark look, with what the page reads of it then and
// a task later, as the note on the icon reads it, and each time the page leaves the screen, comes
// back, or loses or gets focus, with the look it reads and the theme it shows then, since a phone
// can change its look while the page is away and report it only once the page is back.
export const phoneLookLog = createStepLog({
  key: "diagnosticsPhoneLook",
  title: "Phone look",
  isWatched: () => false,
});

/** @typedef {"light" | "dark"} PhoneLook */
/**
 * @typedef {{
 *   reported: PhoneLook,
 *   readThen: PhoneLook,
 *   readLater: PhoneLook,
 *   laterMs: number,
 *   isHidden: boolean,
 *   hasFocus: boolean,
 * }} PhoneLookChange
 */

/**
 * @param {{ isHidden: boolean, hasFocus: boolean }} page
 * @returns {string}
 */
const describePage = ({ isHidden, hasFocus }) =>
  `page ${isHidden ? "hidden" : "shown"}, ${hasFocus ? "focused" : "not focused"}`;

/**
 * @param {PhoneLookChange} change
 * @returns {string}
 */
export const describePhoneLookChange = (change) =>
  [
    `the phone reports ${change.reported}`,
    `reads ${change.readThen}, then ${change.readLater} ${Math.round(change.laterMs)}ms later`,
    describePage(change),
  ].join("; ");

/**
 * @param {Event} event
 * @returns {string}
 */
const namePageEvent = (event) => {
  if (event.type === "visibilitychange")
    return document.hidden ? "the page left the screen" : "the page came back";
  return event.type === "focus" ? "the page got focus" : "the page lost focus";
};

/**
 * @param {{ step: string, phoneLook: PhoneLook, theme: string | undefined }} pageStep
 * @returns {string}
 */
export const describePageStep = ({ step, phoneLook, theme }) =>
  `${step}; reads ${phoneLook}, shows ${theme ?? "no theme"}`;

const readPage = () => ({ isHidden: document.hidden, hasFocus: document.hasFocus() });

/**
 * Logs each change of the phone's look, and of the page's visibility and focus, while
 * Diagnostics is on, to the log and to `noteInRecord`, which puts it among the steps of the open or
 * return under way.
 * @param {(text: string) => void} noteInRecord
 */
export function watchPhoneLook(noteInRecord) {
  /** @param {string} text */
  const noteChange = (text) => {
    phoneLookLog.noteStep(text);
    noteInRecord(text);
  };
  /** @param {MediaQueryListEvent} event */
  const noteLookChange = (event) => {
    if (!phoneLookLog.isLogging()) return;
    const reported = event.matches ? "dark" : "light";
    const readThen = readPhoneLook();
    const page = readPage();
    const changedAt = performance.now();
    setTimeout(() => {
      const laterMs = performance.now() - changedAt;
      noteChange(
        describePhoneLookChange({
          reported,
          readThen,
          readLater: readPhoneLook(),
          laterMs,
          ...page,
        }),
      );
    });
  };
  /** @param {Event} event */
  const notePageEvent = (event) => {
    if (!phoneLookLog.isLogging()) return;
    noteChange(
      describePageStep({
        step: namePageEvent(event),
        phoneLook: readPhoneLook(),
        theme: document.documentElement.dataset.theme,
      }),
    );
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", noteLookChange);
  document.addEventListener("visibilitychange", notePageEvent);
  addEventListener("focus", notePageEvent);
  addEventListener("blur", notePageEvent);
}
