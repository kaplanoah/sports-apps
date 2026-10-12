import { readEasternDay } from "#shared/days.js";
import { listSeasonYears } from "#shared/season-picker.js";
import { createSeasonReader, isReadableSeason } from "#shared/season-reader.js";
import { namePlayerIndexKey } from "./search-pages.js";
import { session } from "./session.js";
import { SNAPSHOT_VERSION, nameScheduleKey } from "./snapshot.js";

// The Worker keeps each season in the store as it plays out, says which season is current, and
// pushes every change to the page, which the shared season reader follows.

const UNREACHABLE = "Can't reach the page's server right now";

/** @type {ReturnType<typeof createSeasonReader> | null} */
let reader = null;
/** @type {number | null} */
let scheduleYear = null;
let unwatchSchedule = () => {};
/** @type {number | null} */
let playerIndexYear = null;
let unwatchPlayerIndex = () => {};

/**
 * Follows every game of the season shown, which the store keeps apart from its record, and redraws
 * with `showChange` for each change. A list in a version the page doesn't read is left out, so the
 * view lists the record's own games.
 * @param {number} year
 * @param {() => void} showChange
 */
function followSchedule(year, showChange) {
  if (year === scheduleYear) return;
  scheduleYear = year;
  unwatchSchedule();
  unwatchSchedule = session.db.doc(nameScheduleKey(year)).onSnapshot(
    (/** @type {any} */ snapshot) => {
      if (year !== scheduleYear) return;
      const schedule = snapshot.exists ? snapshot.data() : null;
      session.schedule = isReadableSeason(schedule, SNAPSHOT_VERSION) ? schedule : null;
      showChange();
    },
    () => {},
  );
}

/**
 * Follows the list of players the store keeps for the season shown, for search, which redraws with
 * `showChange` as it changes. A list the page can't read is left out, as is one for a season the
 * page has moved on from.
 * @param {number} year
 * @param {() => void} showChange
 */
function followPlayerIndex(year, showChange) {
  if (year === playerIndexYear) return;
  playerIndexYear = year;
  unwatchPlayerIndex();
  session.playerIndex = null;
  unwatchPlayerIndex = session.db.doc(namePlayerIndexKey(year)).onSnapshot(
    (/** @type {any} */ snapshot) => {
      if (year !== playerIndexYear) return;
      const index = snapshot.exists ? snapshot.data() : null;
      session.playerIndex = Array.isArray(index?.players) ? index : null;
      showChange();
    },
    () => {},
  );
}

const noteUnreachable = () => {
  session.problem = UNREACHABLE;
};

/**
 * Starts reading the season, and redraws with `showChange` for each change after it loads, with
 * `showStamp` for each status of the store's last update or problem reading it, and with
 * `showCurrentYear` when the store moves on to a new season. A record in a version the page doesn't
 * read calls `showUnreadable`.
 * @param {{ showChange: () => void, showStamp: () => void, showCurrentYear: () => void, showUnreadable: () => void }} handlers
 */
export function startSeasonData({ showChange, showStamp, showCurrentYear, showUnreadable }) {
  reader = createSeasonReader({
    store: session.db,
    version: SNAPSHOT_VERSION,
    showUnreadable,
    guessYear: (now) => readEasternDay(now).year,
    keepSeason: (year, season) => {
      if (year !== session.year) session.schedule = null;
      Object.assign(session, { year, season, problem: "" });
      followSchedule(year, showChange);
      followPlayerIndex(year, showChange);
    },
    showChange,
    showStatus: (status) => {
      session.status = status;
      showStamp();
    },
    showLoadFailure: () => {
      noteUnreachable();
      showStamp();
    },
    noteCurrentYear: (year) => {
      session.currentYear = year;
      showCurrentYear();
    },
  });
}

// A page whose load failed may be watching a season the store doesn't have yet, and the store may
// have moved on to a new season, so a retry loads the current season again.
export async function loadSeason() {
  try {
    await reader?.loadCurrentSeason();
    session.currentYear = reader?.readCurrentYear() ?? session.currentYear;
  } catch {
    noteUnreachable();
  }
}

/** @param {number} year */
export async function showYear(year) {
  try {
    await reader?.showYear(year);
  } catch {
    noteUnreachable();
  }
}

/** The years of the seasons the store keeps, newest first. */
export async function loadSeasonYears() {
  const result = await session.db.collection("seasons").limit(50).get();
  return listSeasonYears(result.docs);
}
