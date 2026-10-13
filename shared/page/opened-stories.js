// The stories this device has opened from the News view or search, so each one's Read button shows
// a check.
// It forgets a story two weeks after opening it, by when the view no longer shows it.

import { createViewerChoice } from "./device-storage.js";

const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * When each story was opened, by its address.
 * @typedef {Record<string, number>} OpenedStories
 */

/**
 * The stories opened within two weeks of `now`.
 * @param {OpenedStories} opened
 * @param {number} now
 * @returns {OpenedStories}
 */
export const keepRecentOpens = (opened, now) =>
  Object.fromEntries(
    Object.entries(opened).filter(
      ([, openedAt]) => typeof openedAt === "number" && now - openedAt < KEEP_MS,
    ),
  );

/**
 * @param {unknown} stored
 * @returns {OpenedStories}
 */
const readOpens = (stored) =>
  stored && typeof stored === "object"
    ? keepRecentOpens(/** @type {OpenedStories} */ (stored), Date.now())
    : {};

const openedStories = createViewerChoice("openedStories", readOpens);

export const readOpenedStories = () => openedStories.read();

/**
 * Keeps each story opened from a link in `element`, as search's rows open them too, and calls
 * `onChange` after each one.
 * @param {HTMLElement} element
 * @param {() => void} onChange
 */
export function keepOpenedStories(element, onChange) {
  element.addEventListener("click", (event) => {
    const link = event.target instanceof Element && event.target.closest("a[href]");
    if (!link) return;
    openedStories.keep({ ...readOpenedStories(), [link.getAttribute("href") ?? ""]: Date.now() });
    onChange();
  });
}

/**
 * Keeps each story opened from a link in `list`, and calls `onChange` after each one opened here or
 * in another tab.
 * @param {HTMLElement} list
 * @param {() => void} onChange
 */
export function startOpenedStories(list, onChange) {
  keepOpenedStories(list, onChange);
  openedStories.watch(onChange);
}
