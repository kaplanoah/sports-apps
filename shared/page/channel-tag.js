// The tag beside the app's name on any channel but production, like beta: the channel, the commit
// its page runs, and how long ago that went live, so a phone shows which push it's on without
// opening settings. The page supplies the tag (#channelTag) in its title row.

import { html, joinWithSeparator, setHtml } from "./html.js";
import { loadRelease } from "./release.js";
import { watchTimeAway } from "./resume.js";

const MINUTE_MS = 60 * 1000;

/**
 * How long ago a moment was: "just now", then minutes, whole hours, and days.
 * @param {number} ms
 */
export function describeTimeSince(ms) {
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * The tag's facts, or null for production, whose release has no label, and for a release the
 * Worker no longer has.
 * @param {import("./release.js").Release} release
 * @param {number} now
 * @returns {string[] | null}
 */
export function listChannelFacts({ label, commit, builtAt }, now) {
  if (!label || !builtAt) return null;
  return [label, commit, describeTimeSince(now - Date.parse(builtAt))];
}

/**
 * The tag's facts as of now, from the release `readRelease` reads. A release that can't be read,
 * as offline, leaves the tag hidden rather than failing the page.
 * @param {() => Promise<import("./release.js").Release | null>} readRelease
 */
export async function readChannelFacts(readRelease) {
  const release = await readRelease().catch(() => null);
  return release && listChannelFacts(release, Date.now());
}

async function drawTag() {
  const facts = await readChannelFacts(loadRelease);
  const tag = /** @type {HTMLElement} */ (document.getElementById("channelTag"));
  setHtml(tag, facts ? joinWithSeparator(facts) : html``);
  tag.hidden = !facts;
}

export function startChannelTag() {
  drawTag();
  setInterval(drawTag, MINUTE_MS);
  watchTimeAway(drawTag);
}
