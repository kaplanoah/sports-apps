// A tuning round, while an app's page/tuning-round.json holds one, is tried on the phone on any
// channel but production: the build writes the round into the page and loads the tuning panel
// (shared/page/tuning-panel.js). Production never serves the panel, its round, or its files.

import { applyPageEdits, findPageEnd, writeJsonScript } from "./page-files.mjs";

const ROUND_FILE = "tuning-round.json";
const PANEL_FILES = ["shared/tuning-panel.js", "shared/tuning-panel.css", "shared/tuning-round.js"];

/** @typedef {Record<string, { contentType: string, text?: string, base64?: string }>} PageFiles */

/** @param {string} round the round as JSON */
const writePanelTags = (round) =>
  [
    writeJsonScript("tuningRound", JSON.parse(round)),
    '<link rel="stylesheet" href="shared/tuning-panel.css" />',
    '<script type="module" src="shared/tuning-panel.js"></script>',
  ].join("\n");

/**
 * @param {PageFiles} files
 * @param {string[]} paths
 */
const leaveOut = (files, paths) =>
  Object.fromEntries(Object.entries(files).filter(([path]) => !paths.includes(path)));

/**
 * @param {string} page
 * @param {string} text
 */
function insertAtPageEnd(page, text) {
  const offset = findPageEnd(page);
  return applyPageEdits(page, [{ startOffset: offset, endOffset: offset, text }]);
}

/**
 * The page files with the tuning panel loaded on a channel with a label while a round is open,
 * and without the panel's files anywhere else.
 * @param {PageFiles} files
 * @param {string | null} label the channel's label, null for production
 * @returns {PageFiles}
 */
export function addTuningPanel(files, label) {
  const round = files[ROUND_FILE]?.text;
  if (!label || !round) return leaveOut(files, [ROUND_FILE, ...PANEL_FILES]);
  const page = files["index.html"];
  const text = page.text && insertAtPageEnd(page.text, `${writePanelTags(round)}\n`);
  return { ...leaveOut(files, [ROUND_FILE]), "index.html": { ...page, text } };
}
