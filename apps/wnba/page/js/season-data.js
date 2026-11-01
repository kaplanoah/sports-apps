import { readEasternDay } from "#shared/days.js";
import { listSeasonYears } from "#shared/season-picker.js";
import { createSeasonPicks, createSeasonReader, isReadableSeason } from "#shared/season-reader.js";
import { namePlayerIndexKey, readPlayerIndex } from "#shared/page-search.js";
import { createSeasonDocFollower } from "#shared/season-doc-follower.js";
import { nameOvertimesKey } from "./search-pages.js";
import { session } from "./session.js";
import { SNAPSHOT_VERSION, nameScheduleKey } from "./snapshot.js";

// The Worker keeps each season in the store as it plays out, says which season is current, and
// pushes every change to the page, which the shared season reader follows.

const UNREACHABLE = "Can't reach the page's server right now";

/** @type {ReturnType<typeof createSeasonReader> | null} */
let reader = null;
/** @type {(year: number) => Promise<void>} */
let pickSeason = async () => {};
/** @type {number | null} */
let scheduleYear = null;
let unwatchSchedule = () => {};

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
  session.isScheduleDue = true;
  unwatchSchedule();
  unwatchSchedule = session.db.doc(nameScheduleKey(year)).onSnapshot(
    (/** @type {any} */ snapshot) => {
      if (year !== scheduleYear) return;
      const schedule = snapshot.exists ? snapshot.data() : null;
      session.schedule = isReadableSeason(schedule, SNAPSHOT_VERSION) ? schedule : null;
      session.isScheduleDue = false;
      showChange();
    },
    () => {
      if (year !== scheduleYear) return;
      session.isScheduleDue = false;
      showChange();
    },
  );
}

// The list of players search finds, and which finals went to overtime.
const followPlayerIndex = createSeasonDocFollower({
  nameKey: namePlayerIndexKey,
  read: readPlayerIndex,
  keep: (index) => {
    session.playerIndex = index;
  },
});
const followOvertimes = createSeasonDocFollower({
  nameKey: nameOvertimesKey,
  read: (overtimes) =>
    overtimes?.games && typeof overtimes.games === "object" ? overtimes.games : null,
  keep: (games) => {
    session.overtimes = games;
  },
});

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
    readPick: () => session.pickedYear,
    version: SNAPSHOT_VERSION,
    showUnreadable,
    guessYear: (now) => readEasternDay(now).year,
    keepSeason: (year, season) => {
      if (year !== session.year) session.schedule = null;
      Object.assign(session, { year, pickedYear: year, season, problem: "" });
      followSchedule(year, showChange);
      followPlayerIndex(session.db, year, showChange);
      followOvertimes(session.db, year, showChange);
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
  pickSeason = createSeasonPicks({
    reader,
    keepPick: (year) => {
      session.pickedYear = year;
    },
  });
}

// A page showing a past season, as its last showing does on a reload, loads it again, and one
// showing the current season loads whichever the store now says is current, as it may have moved on.
export async function loadSeason() {
  try {
    await reader?.reloadSeason(session.year, session.currentYear);
    session.currentYear = reader?.readCurrentYear() ?? session.currentYear;
  } catch {
    /* the reader has reported the failure */
  }
}

/**
 * Shows the season picked, keeping it in `session.pickedYear` while its record is on its way.
 * @type {(year: number) => Promise<void>}
 */
export const showYear = (year) => pickSeason(year);

/** @param {(selection: import("#shared/season-reader.js").SeasonSelection) => void} watcher */
export const watchSeasonSelection = (watcher) => reader?.watchSelection(watcher);

/** The years of the seasons the store keeps, newest first. */
export async function loadSeasonYears() {
  const result = await session.db.collection("seasons").limit(50).get();
  return listSeasonYears(result.docs);
}
