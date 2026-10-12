// The Roster section of a club's sheet, beside its Team section: the club's roster, which the store
// keeps for the current season, read as the sheet shows the club and again once it's old, and
// which the Team section's leaders read too. A roster that didn't load reads again on a tap on Try
// again, as the phone comes back online or the page comes back, or a minute later. The club's sheet
// keeps what the section shows, so a reload draws it again while it reads again.

import { html, setHtml } from "#shared/html.js";
import { classifyReadFailure, watchRetries } from "#shared/retry.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";
import { renderRoster } from "./roster-view.js";
import { session } from "./session.js";

/** @typedef {import("./roster-view.js").Roster} Roster */
/** @typedef {import("#shared/retry.js").ReadFailure} ReadFailure */
/** @typedef {{ at: number, roster: Roster | null, isLoading: boolean, failure: ReadFailure | null }} RosterRead */

const FETCH_TIMEOUT_MS = 15 * 1000;
// A roster changes with a transaction, and its numbers after each game.
const READ_AGAIN_MS = 10 * 60 * 1000;
// A roster that didn't load is read again a minute later.
const RETRY_MS = 60 * 1000;

/** @type {Map<string, RosterRead>} */
const reads = new Map();
/** @type {string | null} */
let shownClub = null;
// Draws what the club's sheet shows from a roster just read.
let showRead = () => renderSection();

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} club */
const fetchRoster = (club) =>
  fetchFromWorker(`store/rosters/${encodeURIComponent(club)}`, {
    reuseMs: READ_AGAIN_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    isExpected: (body) => "data" in body,
  });

/** @param {RosterRead} read */
const isFresh = (read) =>
  read.isLoading || Date.now() - read.at < (read.roster ? READ_AGAIN_MS : RETRY_MS);

/**
 * Keeps what a read found, or what the last one did when it failed or found none, and why.
 * @param {string} club
 * @param {RosterRead} read
 * @param {Roster | null} found
 * @param {ReadFailure | null} failure
 */
function keepRead(club, read, found, failure) {
  if (reads.get(club) !== read) return;
  reads.set(club, { ...read, isLoading: false, roster: found ?? read.roster, failure });
  if (shownClub === club) showRead();
}

/**
 * The club's last read, after starting a new one when it has none or it's old.
 * @param {string} club
 */
function readRoster(club) {
  const kept = reads.get(club);
  if (kept && isFresh(kept)) return kept;
  /** @type {RosterRead} */
  const read = { at: Date.now(), roster: kept?.roster ?? null, isLoading: true, failure: null };
  reads.set(club, read);
  fetchRoster(club).then(
    // A store that keeps no roster for the club answered, though not with what the page needs.
    (body) => keepRead(club, read, body.data, body.data ? null : "server"),
    (error) => keepRead(club, read, null, classifyReadFailure(error)),
  );
  return read;
}

const isCurrentSeason = () => session.activeYear === session.currentSeason;

function renderSection() {
  if (!shownClub) return;
  const body = findElement("rosterBody");
  if (!isCurrentSeason()) {
    setHtml(body, html`<p class="sheet-message">Rosters show for the current season only</p>`);
    return;
  }
  const { roster, isLoading, failure } = readRoster(shownClub);
  setHtml(body, renderRoster(roster, { isLoading, failure }));
}

// A read that failed is dropped, so the section shows its placeholders while it reads again.
function retryRoster() {
  if (!shownClub) return;
  const read = reads.get(shownClub);
  if (!read || read.roster || read.isLoading) return;
  reads.delete(shownClub);
  renderSection();
}

/**
 * The club's roster as its Team section's leaders show it: the section's last read, or one under
 * way before the section starts it, or null for a season the store keeps no rosters for.
 * @param {string} club
 * @returns {RosterRead | null}
 */
export function findClubRoster(club) {
  if (!isCurrentSeason()) return null;
  return reads.get(club) ?? { at: 0, roster: null, isLoading: true, failure: null };
}

/**
 * Has a tap on Try again, in the section or the leaders, the phone coming back online, or the page
 * coming back read again, and `showChange` draw the club's sheet again from each roster read.
 * @param {{ showChange: () => void }} handlers
 */
export function startRosterSection({ showChange }) {
  showRead = showChange;
  watchRetries(findElement("rosterBody"), retryRoster);
  watchRetries(findElement("teamBody"), retryRoster);
}

/**
 * Fills the section in with a club's roster.
 * @param {string} club
 */
export function fillRoster(club) {
  shownClub = club;
  renderSection();
}

/** @param {any} saved */
const isSavedRoster = (saved) =>
  typeof saved?.club === "string" && Array.isArray(saved.roster?.players);

/** What the section shows, for the club's sheet to keep. */
export function readShownRoster() {
  const roster = shownClub ? reads.get(shownClub)?.roster : null;
  return shownClub && roster ? { club: shownClub, roster } : null;
}

/**
 * Takes back what the section showed, to show while it reads again, unless it has read since.
 * @param {unknown} saved what readShownRoster found
 */
export function reopenRoster(saved) {
  if (!isSavedRoster(saved)) return;
  const { club, roster } = /** @type {{ club: string, roster: Roster }} */ (saved);
  if (!reads.has(club)) reads.set(club, { at: 0, roster, isLoading: false, failure: null });
}
