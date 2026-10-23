import { createSeasonPicks, createSeasonReader, isReadableSeason } from "#shared/season-reader.js";
import { listSeasonYears } from "#shared/season-picker.js";
import { buildBracket } from "./bracket.js";
import { namePlayerIndexKey, readPlayerIndex } from "#shared/page-search.js";
import { createSeasonDocFollower } from "#shared/season-doc-follower.js";
import { SNAPSHOT_VERSION, nameScheduleCollection } from "./snapshot.js";
import { composeState, guessSeasonYear, session } from "./session.js";
import { TEAMS } from "./teams.js";

// The Worker keeps each season's record in the store as it plays out, says which season is
// current, and pushes every change to the page, which the shared season reader follows.

const UNREACHABLE = "Can't reach the page's server right now";

/** @type {ReturnType<typeof createSeasonReader> | null} */
let reader = null;
/** @type {(year: number) => Promise<void>} */
let pickSeason = async () => {};
/** @type {{ year: number, record: any } | null} */
let deferredSeason = null;
/** @type {number | null} */
let scheduleYear = null;
let unwatchSchedule = () => {};
// A season's games run from March to November, a month to a document.
const SCHEDULE_MONTHS = 12;

/**
 * Every game of a season, from its months the store keeps, or null when it keeps none the page
 * reads. A month in a version the page doesn't read is left out.
 * @param {{ data: () => any }[]} docs
 */
function readSchedule(docs) {
  const months = docs
    .map((doc) => doc.data())
    .filter((month) => isReadableSeason(month, SNAPSHOT_VERSION) && Array.isArray(month.games));
  return months.length ? months.flatMap((month) => month.games) : null;
}

/**
 * Follows every game of the season shown, which the store keeps apart from its record, and redraws
 * with `showChange` for each change.
 * @param {number} year
 * @param {() => void} showChange
 */
function followSchedule(year, showChange) {
  if (year === scheduleYear) return;
  scheduleYear = year;
  unwatchSchedule();
  unwatchSchedule = session.db
    .collection(nameScheduleCollection(year))
    .limit(SCHEDULE_MONTHS)
    .onSnapshot(
      (/** @type {{ docs: { data: () => any }[] }} */ result) => {
        if (year !== scheduleYear) return;
        session.schedule = readSchedule(result.docs);
        if (!session.isReordering) showChange();
      },
      () => {},
    );
}

// The list of players search finds, which the store keeps for the current season, whichever
// season shows, as the rosters it's made from are the current season's.
const followPlayerIndex = createSeasonDocFollower({
  nameKey: namePlayerIndexKey,
  read: readPlayerIndex,
  keep: (index) => {
    session.playerIndex = index;
  },
});

const keepKnownClubs = (teams) =>
  Object.fromEntries(Object.entries(teams || {}).filter(([id]) => TEAMS[id]));

/**
 * A season's record as the page reads it, or an empty season for a year with no record.
 * @param {any} record
 * @param {number} year
 */
function normalizeSeason(record, year) {
  const season = record ?? {};
  return {
    ...season,
    year,
    teams: keepKnownClubs(season.teams),
    series: season.series ?? {},
    log: Array.isArray(season.log) ? season.log : [],
  };
}

/**
 * @param {number} year
 * @param {any} record
 */
function applySeason(year, record) {
  Object.assign(session, { activeYear: year, season: normalizeSeason(record, year), problem: "" });
  composeState();
}

// A drag keeps the order it shows, so a season that arrives during one waits for it to end.
/**
 * @param {number} year
 * @param {any} record
 */
function keepSeason(year, record) {
  if (session.isReordering) deferredSeason = { year, record };
  else applySeason(year, record);
}

export function applyDeferredSeason() {
  if (!deferredSeason) return;
  applySeason(deferredSeason.year, deferredSeason.record);
  deferredSeason = null;
}

// A page that couldn't read its season shows an empty one, and loads it again when it's next opened.
function noteUnreachable() {
  if (!session.season) applySeason(session.activeYear, null);
  session.problem = UNREACHABLE;
}

/**
 * Starts reading the season, and redraws with `showChange` for each change after it loads, with
 * `showStamp` for each status of the store's last update or problem reading it, and with
 * `showCurrentYear` when the store moves on to a new season. A record in a version the page
 * doesn't read calls `showUnreadable`.
 * @param {{ showChange: () => void, showStamp: () => void, showCurrentYear: () => void, showUnreadable: () => void }} handlers
 */
export function startSeasonData({ showChange, showStamp, showCurrentYear, showUnreadable }) {
  reader = createSeasonReader({
    store: session.db,
    readPick: () => session.activeYear,
    version: SNAPSHOT_VERSION,
    guessYear: guessSeasonYear,
    showUnreadable,
    // The games the page last showed stay until the store answers with the same season's, so the
    // list doesn't drop to the slate's few days in between.
    keepSeason: (year, record) => {
      if (year !== session.season?.year) session.schedule = null;
      keepSeason(year, record);
      followSchedule(year, showChange);
      followPlayerIndex(session.db, reader?.readCurrentYear() ?? year, () => {
        if (!session.isReordering) showChange();
      });
    },
    showChange: () => {
      if (!session.isReordering) showChange();
    },
    showStatus: (status) => {
      session.status = status;
      showStamp();
    },
    showLoadFailure: () => {
      noteUnreachable();
      showStamp();
    },
    noteCurrentYear: (year) => {
      session.currentSeason = year;
      showCurrentYear();
    },
  });
  pickSeason = createSeasonPicks({
    reader,
    keepPick: (year) => {
      session.activeYear = year;
    },
  });
}

// A page showing a past season, as its last showing does on a reload, loads it again, and one
// showing the current season loads whichever the store now says is current, as it may have moved on.
export async function loadSeason() {
  try {
    await reader?.reloadSeason(session.activeYear, session.currentSeason);
    session.currentSeason = reader?.readCurrentYear() ?? session.currentSeason;
  } catch {
    /* the reader has reported the failure */
  }
}

/**
 * Shows the season picked, keeping it in `session.activeYear` while its record is on its way.
 * @type {(year: number) => Promise<void>}
 */
export const showYear = (year) => pickSeason(year);

/** @param {(selection: import("#shared/season-reader.js").SeasonSelection) => void} watcher */
export const watchSeasonSelection = (watcher) => reader?.watchSelection(watcher);

function collectTrackedTitles(docs) {
  const titles = {};
  for (const stored of docs) {
    const doc = stored.data();
    if (!doc || !doc.teams || !doc.series) continue;
    const year = Number(doc.year ?? stored.id);
    const champion = buildBracket({ ...doc, teams: keepKnownClubs(doc.teams) }).ws?.winner;
    if (champion && Number.isFinite(year)) titles[champion] = [...(titles[champion] ?? []), year];
  }
  return titles;
}

// The seasons the store keeps, newest first, and every title they record.
export async function loadSeasonList() {
  const result = await session.db.collection("seasons").limit(50).get();
  session.trackedTitles = collectTrackedTitles(result.docs);
  return listSeasonYears(result.docs);
}
