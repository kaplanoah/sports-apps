import { isSameJson } from "./compare.js";

// Reads a league's season from the store, which says which season is current, so a page never goes
// by its own clock, and pushes each change to the season's record. A page showing the current
// season moves on to the next one when the store does.

const CURRENT_PATH = "live/current";
const STATUS_PATH = "live/status";

/** @param {number} year */
const nameSeasonPath = (year) => `seasons/${year}`;

/**
 * Whether a page reads a season's record: one saved before records had a version, or one in the
 * version the page knows.
 * @param {any} season
 * @param {number} version
 */
export const isReadableSeason = (season, version) =>
  season?.version === undefined || season.version === version;

/**
 * @typedef {object} SeasonReaderOptions
 * @property {any} store the page's store, from `createWorkerStore`
 * @property {number} version the version of the season's record the page reads
 * @property {(now: number) => number} guessYear the season the clock suggests, for a store that
 *   hasn't yet said which is current
 * @property {(year: number, season: any) => void} keepSeason takes each answer for the shown
 *   season's record, null when it has none
 * @property {() => void} showChange redraws for an answer that comes after the season has loaded
 * @property {(status: any) => void} showStatus takes the store's status of its last update
 * @property {() => void} showUnreadable says a record came in a version the page doesn't read, as
 *   a newer release's Worker saves it, so the page reloads once that release is out
 * @property {() => void} showLoadFailure says the new current season couldn't be read as the
 *   store moved on to it, so the page loads the current season again later
 * @property {(year: number) => void} [noteCurrentYear] hears that the store names a new current
 *   season, once a page showing the current one has moved on to it, and whether or not it has
 */

/** @param {SeasonReaderOptions} options */
export function createSeasonReader({
  store,
  version,
  guessYear,
  keepSeason,
  showChange,
  showStatus,
  showUnreadable,
  showLoadFailure,
  noteCurrentYear = () => {},
}) {
  /** @type {number | null} */
  let currentYear = null;
  /** @type {number | null} */
  let shownYear = null;
  // The record as the store last answered, whether or not the page reads it.
  /** @type {any} */
  let lastRecord = null;
  let unwatchSeason = () => {};
  let isFollowing = false;

  /** @param {string} path */
  async function readDoc(path) {
    const snapshot = await store.doc(path).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  // A store that hasn't said which season is current has the clock's guess once it has a record
  // for it, which is then already read, and otherwise the season before.
  /** @returns {Promise<{ year: number, record?: any }>} */
  async function readUnsaidSeason() {
    const year = guessYear(Date.now());
    const record = await readDoc(nameSeasonPath(year));
    return record ? { year, record } : { year: year - 1 };
  }

  /** @returns {Promise<{ year: number, record?: any }>} */
  async function readCurrentSeason() {
    const current = await readDoc(CURRENT_PATH);
    return current ? { year: current.season } : readUnsaidSeason();
  }

  /** @param {any} season */
  function isReadable(season) {
    if (isReadableSeason(season, version)) return true;
    showUnreadable();
    return false;
  }

  // The record is read once, which answers at once, and then watched. Once it has loaded, a record
  // that answers it doesn't exist is a gap, as when the store restarts for a deploy, and the page
  // keeps what it shows.
  /** @param {number} year */
  function watchSeason(year) {
    unwatchSeason();
    unwatchSeason = store.doc(nameSeasonPath(year)).onSnapshot(
      (/** @type {any} */ snapshot) => {
        if (year !== shownYear || !snapshot.exists) return;
        if (isSameJson(snapshot.data(), lastRecord)) return;
        lastRecord = snapshot.data();
        if (!isReadable(lastRecord)) return;
        keepSeason(year, lastRecord);
        showChange();
      },
      () => {},
    );
  }

  /**
   * @param {number} year
   * @param {any} [readRecord]
   */
  async function readShownSeason(year, readRecord) {
    const before = shownYear;
    shownYear = year;
    try {
      return readRecord ?? (await readDoc(nameSeasonPath(year)));
    } catch (error) {
      if (shownYear === year) shownYear = before;
      throw error;
    }
  }

  /**
   * Shows a season's record, resolving once it has loaded, and then follows its changes. A read
   * that fails leaves the season shown before, and its changes, followed.
   * @param {number} year
   * @param {any} [readRecord] the record, when it has just been read
   */
  async function showYear(year, readRecord) {
    const season = await readShownSeason(year, readRecord);
    if (year !== shownYear) return;
    lastRecord = season;
    keepSeason(year, isReadable(season) ? season : null);
    watchSeason(year);
  }

  /** @param {number} year */
  async function moveOnToYear(year) {
    const wasShowingCurrent = shownYear === currentYear;
    currentYear = year;
    try {
      if (!wasShowingCurrent) return;
      await showYear(year);
      showChange();
    } finally {
      noteCurrentYear(year);
    }
  }

  function followStore() {
    if (isFollowing) return;
    isFollowing = true;
    store.doc(CURRENT_PATH).onSnapshot(
      (/** @type {any} */ snapshot) => {
        const year = snapshot.exists ? snapshot.data().season : null;
        if (year !== null && year !== currentYear) moveOnToYear(year).catch(showLoadFailure);
      },
      () => {},
    );
    store.doc(STATUS_PATH).onSnapshot(
      (/** @type {any} */ snapshot) => showStatus(snapshot.exists ? snapshot.data() : null),
      () => {},
    );
  }

  // A load that failed is tried again by loading again, since the store may since have answered
  // or moved on to a new season.
  async function loadCurrentSeason() {
    try {
      const { year, record } = await readCurrentSeason();
      currentYear = year;
      await showYear(year, record);
    } finally {
      followStore();
    }
  }

  return {
    /** Loads the season the store says is current, and then follows the store. */
    loadCurrentSeason,
    /** @param {number} year */
    showYear: (year) => showYear(year),
    /** The season the store says is current, or null before it has said. */
    readCurrentYear: () => currentYear,
  };
}
