// The Roster section of a club's sheet, beside its Team section: the club's roster, which the store
// keeps for the current season, read as the sheet shows the club and again once it's old, and
// which the Team section's leaders read too. A roster that didn't load reads again on a tap on Try
// again, as the phone comes back online or the page comes back, or a minute later. The club's sheet
// keeps what the section shows, so a reload draws it again while it reads again.

import { html, setHtml } from "#shared/html.js";
import { watchRetries } from "#shared/retry.js";
import {
  createSheetReads,
  SHEET_FETCH_TIMEOUT_MS,
  SHEET_READ_AGAIN_MS,
} from "#shared/sheet-reads.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";
import { renderRoster } from "./roster-view.js";
import { isPastSeason } from "./session.js";

/** @typedef {import("./roster-view.js").Roster} Roster */
/** @typedef {import("#shared/sheet-reads.js").SheetRead<{ roster: Roster | null }>} RosterRead */

/** @type {string | null} */
let shownClub = null;
// Draws what the club's sheet shows from a roster just read.
let showRead = () => renderSection();

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} club */
const fetchRoster = (club) =>
  fetchFromWorker(`store/rosters/${encodeURIComponent(club)}`, {
    reuseMs: SHEET_READ_AGAIN_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => "data" in body,
  });

// Each read is kept by its club.
const reads = createSheetReads({
  empty: { roster: /** @type {Roster | null} */ (null) },
  hasFound: (read) => !!read.roster,
  show: (club) => {
    if (shownClub === club) showRead();
  },
});

/**
 * The club's last read, after starting a new one when it has none or it's old.
 * @param {string} club
 */
const readRoster = (club) =>
  reads.read(club, () =>
    fetchRoster(club).then((body) => ({
      found: { roster: body.data },
      // A store that keeps no roster for the club answered, though not with what the page needs.
      failure: body.data ? null : /** @type {const} */ ("server"),
    })),
  );

function renderSection() {
  if (!shownClub) return;
  const body = findElement("rosterBody");
  if (isPastSeason()) {
    setHtml(body, html`<p class="sheet-message">Rosters show for the current season only</p>`);
    return;
  }
  const { roster, isLoading, failure } = readRoster(shownClub);
  setHtml(body, renderRoster(roster, { isLoading, failure }));
}

// A read that failed is dropped, so the section shows its placeholders while it reads again.
function retryRoster() {
  if (shownClub && reads.drop(shownClub)) renderSection();
}

/**
 * The club's roster as its Team section's leaders show it: the section's last read, or one under
 * way before the section starts it, or null for a season the store keeps no rosters for.
 * @param {string} club
 * @returns {RosterRead | null}
 */
export function findClubRoster(club) {
  if (isPastSeason()) return null;
  return reads.find(club) ?? { at: 0, roster: null, isLoading: true, failure: null };
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
  const roster = shownClub ? reads.find(shownClub)?.roster : null;
  return shownClub && roster ? { club: shownClub, roster } : null;
}

/**
 * Takes back what the section showed, to show while it reads again, unless it has read since.
 * @param {unknown} saved what readShownRoster found
 */
export function reopenRoster(saved) {
  if (!isSavedRoster(saved)) return;
  const { club, roster } = /** @type {{ club: string, roster: Roster }} */ (saved);
  reads.keepShown(club, { roster });
}
