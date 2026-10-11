// The Roster section of a team's sheet, beside its Team section: the team's roster for the season
// shown, which the store keeps, beside every player's averages that season, which the store also
// keeps, read together as the team's sheet shows a season and again once they're old, sorted by
// the column the viewer picked until the sheet shows another team. Who is out shows only while the
// team still plays. A roster that didn't load reads again on a tap on Try again, as the phone comes
// back online or the page comes back, or a minute later. The team's sheet keeps what the section
// shows, so a reload draws it again while it reads again.

import { setHtml } from "#shared/html.js";
import { classifyReadFailure, watchRetries } from "#shared/retry.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";
import { chooseSort, DEFAULT_SORT, describeRosterNote, renderRoster } from "./roster-view.js";
import { isStillPlaying } from "./series.js";
import { isPastSeason, session } from "./session.js";

/** @typedef {import("./roster-view.js").Roster} Roster */
/** @typedef {import("./roster-view.js").Averages} Averages */
/** @typedef {import("./roster-view.js").RosterSort} RosterSort */
/** @typedef {import("#shared/retry.js").ReadFailure} ReadFailure */
/** @typedef {{ at: number, roster: Roster | null, averages: Averages[], isLoading: boolean, failure: ReadFailure | null }} RosterRead */
/** @typedef {{ team: string, year: number, roster: Roster, averages: Averages[], sort: RosterSort }} SavedRoster */

const FETCH_TIMEOUT_MS = 15 * 1000;
// A roster changes with a signing or an injury, and the averages after each game.
const READ_AGAIN_MS = 10 * 60 * 1000;
// A roster that didn't load is read again a minute later.
const RETRY_MS = 60 * 1000;

// Each read is kept by its team and season, as NYL:2026.
/** @type {Map<string, RosterRead>} */
const reads = new Map();
/** @type {string | null} */
let shownTeam = null;
let sort = DEFAULT_SORT;
/** @type {string | null} */
let sortedTeam = null;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {string} team
 * @param {number} year
 */
const fetchRoster = (team, year) =>
  fetchFromWorker(`roster?team=${encodeURIComponent(team)}&season=${year}`, {
    reuseMs: READ_AGAIN_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    isExpected: (body) => body.team === team && body.season === year && Array.isArray(body.players),
  });

/** @param {number} year */
const fetchAverages = (year) =>
  fetchFromWorker(`store/averages/${year}`, {
    reuseMs: READ_AGAIN_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    isExpected: (body) => "data" in body,
  });

/**
 * Keeps what a read found, or what the last one did where it failed.
 * @param {string} team
 * @param {number} year
 * @param {RosterRead} read
 * @param {[PromiseSettledResult<any>, PromiseSettledResult<any>]} results
 */
function keepRead(team, year, read, [roster, averages]) {
  const key = `${team}:${year}`;
  if (reads.get(key) !== read) return;
  reads.set(key, {
    ...read,
    isLoading: false,
    roster: roster.status === "fulfilled" ? roster.value : read.roster,
    failure: roster.status === "rejected" ? classifyReadFailure(roster.reason) : null,
    averages:
      averages.status === "fulfilled" ? (averages.value.data?.players ?? []) : read.averages,
  });
  if (shownTeam === team) renderSection();
}

/** @param {RosterRead} read */
const isFresh = (read) =>
  read.isLoading || Date.now() - read.at < (read.roster ? READ_AGAIN_MS : RETRY_MS);

/**
 * The team's last read for the season, after starting a new one when it has none or it's old.
 * @param {string} team
 * @param {number} year
 */
function readRoster(team, year) {
  const key = `${team}:${year}`;
  const kept = reads.get(key);
  if (kept && isFresh(kept)) return kept;
  /** @type {RosterRead} */
  const read = {
    at: Date.now(),
    roster: kept?.roster ?? null,
    averages: kept?.averages ?? [],
    isLoading: true,
    failure: null,
  };
  reads.set(key, read);
  Promise.allSettled([fetchRoster(team, year), fetchAverages(year)]).then((results) =>
    keepRead(team, year, read, /** @type {any} */ (results)),
  );
  return read;
}

function renderSection() {
  if (!shownTeam) return;
  const { roster, averages, isLoading, failure } = readRoster(shownTeam, session.year);
  const team = shownTeam;
  const showsOut = !isPastSeason() && isStillPlaying(session.season?.series ?? [], team);
  setHtml(findElement("rosterNote"), describeRosterNote(roster, session.year));
  setHtml(
    findElement("rosterBody"),
    renderRoster({ roster, averages, sort, isLoading, failure, showsOut }),
  );
}

// A read that failed is dropped, so the section shows its placeholders while it reads again.
function retryRoster() {
  if (!shownTeam) return;
  const key = `${shownTeam}:${session.year}`;
  const read = reads.get(key);
  if (!read || read.roster || read.isLoading) return;
  reads.delete(key);
  renderSection();
}

/**
 * Fills the section in with a team's roster, keeping its sort while it's the same team.
 * @param {string} team
 */
export function fillRoster(team) {
  if (sortedTeam !== team) {
    sortedTeam = team;
    sort = DEFAULT_SORT;
  }
  shownTeam = team;
  renderSection();
}

/** @param {any} sort */
const isSort = (sort) => typeof sort?.key === "string" && typeof sort.isDescending === "boolean";

/** @param {any} saved */
const isSavedRoster = (saved) =>
  typeof saved?.team === "string" &&
  typeof saved.year === "number" &&
  Array.isArray(saved.roster?.players) &&
  Array.isArray(saved.averages) &&
  isSort(saved.sort);

/**
 * What the section shows, with only its own players' averages, for the team's sheet to keep.
 * @returns {SavedRoster | null}
 */
export function readShownRoster() {
  const read = shownTeam ? reads.get(`${shownTeam}:${session.year}`) : null;
  if (!shownTeam || !read?.roster) return null;
  const ids = new Set(read.roster.players.map((player) => player.id));
  return {
    team: shownTeam,
    year: session.year,
    roster: read.roster,
    averages: read.averages.filter((each) => ids.has(String(each.id))),
    sort,
  };
}

/**
 * Takes back what the section showed, to show while it reads again, unless it has read since.
 * @param {unknown} saved what readShownRoster found
 */
export function reopenRoster(saved) {
  if (!isSavedRoster(saved)) return;
  const { team, year, roster, averages, sort: savedSort } = /** @type {SavedRoster} */ (saved);
  const key = `${team}:${year}`;
  if (!reads.has(key)) reads.set(key, { at: 0, roster, averages, isLoading: false, failure: null });
  sortedTeam = team;
  sort = savedSort;
}

/** @param {Event} event */
function sortOnTap(event) {
  const button = /** @type {HTMLElement | null} */ (
    /** @type {Element} */ (event.target).closest(".roster-sort")
  );
  if (!button?.dataset.sort) return;
  sort = chooseSort(sort, button.dataset.sort);
  renderSection();
}

// The line at the pinned names' edge shows only once the table has scrolled under them.
/** @param {HTMLElement} section */
const markScrolledAcross = (section) =>
  section.classList.toggle("is-scrolled-across", section.scrollLeft > 0);

export function startRosterSection() {
  const section = findElement("rosterSection");
  findElement("rosterBody").addEventListener("click", sortOnTap);
  watchRetries(findElement("rosterBody"), retryRoster);
  section.addEventListener("scroll", () => markScrolledAcross(section), { passive: true });
}
