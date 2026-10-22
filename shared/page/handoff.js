// A handoff from the Worker: an address that signs a browser in for a few minutes (access-gate.js).
// A Home Screen app keeps its cookies apart from the browser's, so its links that open the page in
// the browser carry one, which it keeps fresh while a link shows.

import { watchTimeAway } from "./resume.js";

const HANDOFF_RETRY_MS = 30 * 1000;

/** @typedef {{ address: string, expiresInMs: number }} Handoff */

// The Worker makes one only for a phone signed in, and only while it asks for a code, so only a
// read that didn't reach it, or that it failed, is worth trying again.
/**
 * @param {string} path the route that makes one, relative to the page
 * @returns {Promise<Handoff | "none" | "failed">}
 */
async function requestHandoff(path) {
  try {
    const response = await fetch(path, { method: "POST" });
    if (response.ok) return await response.json();
    return response.status < 500 ? "none" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Keeps a fresh handoff from `path` while `isWanted` says a link needs one, telling `onRenewed`
 * each time it arrives, or the Worker refuses one. A handoff lasts minutes and a link can show
 * longer, so it asks for a new one halfway through each.
 * @param {{ path: string, isWanted: () => boolean, onRenewed: () => void }} link
 */
export function keepHandoff({ path, isWanted, onRenewed }) {
  /** @type {string | null} */
  let address = null;
  let isRefused = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let renewTimer;
  let renewDueAt = Infinity;
  let isAsking = false;

  /** @param {number} delayMs */
  function scheduleRenewal(delayMs) {
    clearTimeout(renewTimer);
    renewDueAt = Date.now() + delayMs;
    renewTimer = setTimeout(renewHandoff, delayMs);
  }

  function stopRenewals() {
    clearTimeout(renewTimer);
    renewDueAt = Infinity;
  }

  async function renewHandoff() {
    stopRenewals();
    isAsking = true;
    const answer = await requestHandoff(path);
    isAsking = false;
    if (!isWanted()) return;
    if (answer === "failed") {
      scheduleRenewal(HANDOFF_RETRY_MS);
      return;
    }
    isRefused = answer === "none";
    address = isRefused ? null : /** @type {Handoff} */ (answer).address;
    onRenewed();
    if (!isRefused) scheduleRenewal(/** @type {Handoff} */ (answer).expiresInMs / 2);
  }

  // A handoff kept while the link is away would be stale by the time it shows again.
  function followHandoff() {
    if (isWanted()) {
      if (renewDueAt === Infinity && !isAsking) renewHandoff();
      return;
    }
    stopRenewals();
    address = null;
  }

  // A phone freezes the page's timers while it's away, so a renewal they held back goes out as the
  // page comes back.
  watchTimeAway(() => {
    if (Date.now() >= renewDueAt) renewHandoff();
  });

  return {
    follow: followHandoff,
    /** The handoff's address, or null until one arrives or where the Worker refuses one. */
    readAddress: () => address,
    /** Whether the Worker refused the last request, as it does for a phone it hasn't signed in. */
    isRefused: () => isRefused,
  };
}
