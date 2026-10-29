// The settings panel behind the page's settings button, and which release of the page this is.
// Phones show it over the whole screen, which a swipe down closes, wider screens as a modal. It
// stays open off the screen only as long as a view keeps its place.
// The page supplies the button (#settingsBtn) and the dialog (#settingsDialog), with its
// .sheet-top, its close button (.sheet-close), a place for the release (#versionNote), and
// Contact's row (#contactBtn), which opens Contact's own dialog (#contactDialog).

import { formatDateAndTime } from "./days.js";
import { joinWithSeparator, setHtml } from "./html.js";
import { readPageRelease } from "./release.js";
import { openSheet, wireSheet } from "./sheet.js";
import { keepDialogFor } from "./sheet-memory.js";
import { startContact } from "./contact.js";

/* global START_AFTER_AWAY_MS -- from long-away.js */

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const findDialog = () =>
  /** @type {HTMLDialogElement} */ (document.getElementById("settingsDialog"));

/** @param {EventTarget} target */
export const isSettingsControlGesture = (target) =>
  target instanceof Element && !!target.closest("select");

// A version the build couldn't work out leaves the commit in its place.
/** @param {import("./release.js").Release} release */
export function describeRelease({ version, commit, builtAt }) {
  const name = version ? `v${version}` : commit;
  return joinWithSeparator([name, `Released ${formatDateAndTime(new Date(builtAt), new Date())}`]);
}

// The commit is there on hover.
function showRelease() {
  const release = readPageRelease();
  if (!release) return;
  const note = findElement("versionNote");
  setHtml(note, describeRelease(release));
  note.title = `Commit ${release.commit}`;
  note.hidden = false;
}

/**
 * The row of a setting, by the key a search names it by.
 * @param {string} key
 */
const findSettingRow = (key) =>
  /** @type {HTMLElement | null} */ (document.querySelector(`[data-setting="${key}"]`));

/**
 * Whether a search may list a setting: settings itself always, and a setting while its row shows.
 * @param {string} key
 */
export function isSettingShown(key) {
  const row = findSettingRow(key);
  return key === "settings" || (!!row && !row.closest("[hidden]"));
}

// What opens each page of settings, by the key a search names its row by.
/** @type {Map<string, () => void>} */
const pageOpeners = new Map();

/**
 * Opens settings, with the page of settings a search names by its key, or scrolled to its row.
 * @param {string | null} [key]
 */
export function openSettings(key = null) {
  openSheet(findDialog());
  if (!key) return;
  const openPage = pageOpeners.get(key);
  if (openPage) openPage();
  else findSettingRow(key)?.scrollIntoView({ block: "center" });
}

/**
 * Wires the settings button, the dialog's ways to close, and the sheet's swipe, and shows the
 * release. A touch that starts on a picker never moves the sheet.
 * @param {{ pages?: Record<string, () => void> }} [options]
 *   pages: what opens each of the app's own pages of settings, by its row's key
 */
export function startSettingsSheet({ pages = {} } = {}) {
  const dialog = findDialog();
  findElement("settingsBtn").addEventListener("click", () => openSettings());
  wireSheet(dialog, { isOwnGesture: isSettingsControlGesture });
  keepDialogFor(dialog, START_AFTER_AWAY_MS);
  showRelease();
  const openContact = startContact(
    /** @type {HTMLDialogElement} */ (findElement("contactDialog")),
    findElement("contactBtn"),
  );
  for (const [key, openPage] of Object.entries({ ...pages, "settings:contact": openContact }))
    pageOpeners.set(key, openPage);
}
