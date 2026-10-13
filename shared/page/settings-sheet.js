// The settings panel behind the page's settings button, and which release of the page this is.
// Phones show it over the whole screen, which a swipe down closes, wider screens as a modal. It
// stays open off the screen only as long as a view keeps its place.
// The page supplies the button (#settingsBtn) and the dialog (#settingsDialog), with its
// .sheet-top, its close button (#settingsCloseBtn), and a place for the release (#versionNote).

import { formatDateAndTime } from "./days.js";
import { joinWithSeparator, setHtml } from "./html.js";
import { START_AFTER_AWAY_MS } from "./long-away.js";
import { loadRelease } from "./release.js";
import { openSheet, wireSheet } from "./sheet.js";
import { keepDialogFor } from "./sheet-memory.js";

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const findDialog = () =>
  /** @type {HTMLDialogElement} */ (document.getElementById("settingsDialog"));

// A release this Worker no longer has names only its commit, and the page reloads for it, so it
// has no line. A version the build couldn't work out leaves the commit in its place.
/** @param {import("./release.js").Release} release */
export function describeRelease({ version, commit, builtAt }) {
  if (!builtAt) return null;
  const name = version ? `v${version}` : commit;
  return joinWithSeparator([name, `Released ${formatDateAndTime(new Date(builtAt), new Date())}`]);
}

// The commit is there on hover.
async function showRelease() {
  const release = await loadRelease().catch(() => null);
  const line = release && describeRelease(release);
  if (!line) return;
  const note = findElement("versionNote");
  setHtml(note, line);
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

/**
 * Opens settings, scrolled to the setting a search names by its key.
 * @param {string | null} [key]
 */
export function openSettings(key = null) {
  openSheet(findDialog());
  if (key) findSettingRow(key)?.scrollIntoView({ block: "center" });
}

/**
 * Wires the settings button, the dialog's ways to close, and the sheet's swipe, and shows the
 * release. A touch that starts on a target `isOwnGesture` claims, like a drag handle or a picker,
 * never moves the sheet.
 * @param {{ isOwnGesture?: (target: EventTarget) => boolean }} [options]
 */
export function startSettingsSheet({ isOwnGesture } = {}) {
  const dialog = findDialog();
  findElement("settingsBtn").addEventListener("click", () => openSettings());
  wireSheet(dialog, { closeButton: findElement("settingsCloseBtn"), isOwnGesture });
  keepDialogFor(dialog, START_AFTER_AWAY_MS);
  showRelease();
}
