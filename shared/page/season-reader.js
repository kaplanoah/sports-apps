import { isSameJson } from "./compare.js";

// Reads a league's season from the store, which says which season is current, so a page never goes
// by its own clock, and pushes each change to the season's record. A page showing the current
// season moves on to the next one when the store does. Each season a viewer picks is kept while its
// record is on its way, and, once no read is out, put back on the season the page shows when it
// can't be read or the page's own load takes its place.

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
  // The season whose record the page shows, and the one it last asked for, which differ while a
  // record is on its way.
  /** @type {number | null} */
  let shownYear = null;
  /** @type {number | null} */
  let askedYear = null;
  // The record as the store last answered, whether or not the page reads it.
  /** @type {any} */
  let lastRecord = null;
  // The shown season's latest record while another's is on its way, kept for a read that fails, and
  // whether the store moved on from the shown season meanwhile.
  /** @type {any} */
  let heldRecord = null;
  let isMoveOnOwed = false;
  // How many reads are out, a load of the current season counting from its read of which that is,
  // and what waits for none to be.
  let readsOut = 0;
  /** @type {(() => void)[]} */
  let settledWaiters = [];
  let unwatchSeason = () => {};
  let isFollowing = false;

  /**
   * @template T
   * @param {() => Promise<T>} read
   */
  async function countRead(read) {
    readsOut++;
    try {
      return await read();
    } finally {
      readsOut--;
      if (readsOut === 0) {
        const waiters = settledWaiters;
        settledWaiters = [];
        for (const waiter of waiters) waiter();
      }
    }
  }

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

  /**
   * @param {number} year
   * @param {any} record
   */
  function showRecord(year, record) {
    if (isSameJson(record, lastRecord)) return;
    lastRecord = record;
    if (!isReadable(record)) return;
    keepSeason(year, record);
    showChange();
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
        if (askedYear === year) showRecord(year, snapshot.data());
        else heldRecord = snapshot.data();
      },
      () => {},
    );
  }

  // A season that can't be read leaves the page on the season it shows, with any change to it that
  // came while the read was out, and moves it on to a new current season the store named meanwhile.
  function stayOnShownYear() {
    askedYear = shownYear;
    const record = heldRecord;
    heldRecord = null;
    if (shownYear !== null && record !== null) showRecord(shownYear, record);
    if (!isMoveOnOwed) return;
    isMoveOnOwed = false;
    showCurrentYear().catch(showLoadFailure);
  }

  /**
   * Shows a season's record, resolving once it has loaded, and then follows its changes. A read
   * that fails, unless a newer one has taken its place, leaves the page on the season it shows.
   * @param {number} year
   * @param {any} [readRecord] the record, when it has just been read
   */
  function showYear(year, readRecord) {
    return countRead(async () => {
      askedYear = year;
      let season;
      try {
        season = readRecord ?? (await readDoc(nameSeasonPath(year)));
      } catch (error) {
        if (askedYear === year) stayOnShownYear();
        throw error;
      }
      if (year !== askedYear) return;
      shownYear = year;
      heldRecord = null;
      isMoveOnOwed = false;
      lastRecord = season;
      keepSeason(year, isReadable(season) ? season : null);
      watchSeason(year);
    });
  }

  async function showCurrentYear() {
    const year = /** @type {number} */ (currentYear);
    try {
      await showYear(year);
      showChange();
    } finally {
      noteCurrentYear(year);
    }
  }

  // A page asking for the current season moves on with the store. One showing it while a picked
  // season's read is out moves on only if that read fails.
  /** @param {number} year */
  async function moveOnToYear(year) {
    const isAskingCurrent = askedYear === currentYear;
    isMoveOnOwed ||= !isAskingCurrent && shownYear === currentYear;
    currentYear = year;
    if (isAskingCurrent) return showCurrentYear();
    noteCurrentYear(year);
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
      await countRead(async () => {
        const { year, record } = await readCurrentSeason();
        currentYear = year;
        await showYear(year, record);
      });
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
    /** The season whose record the page shows, or null before one has loaded. */
    readShownYear: () => shownYear,
    /**
     * Resolves once no read is out, so what the page shows has settled.
     * @returns {Promise<void>}
     */
    waitForReads: () =>
      readsOut === 0
        ? Promise.resolve()
        : new Promise((resolve) => settledWaiters.push(() => resolve(undefined))),
  };
}

/**
 * How a pick ended, and the season it leaves picked, null before any season has loaded.
 * @typedef {object} PickOutcome
 * @property {"shown" | "replaced" | "unread" | "overtaken"} kind its season shown, a newer pick
 *   taking its place, its record unread, or the page's own load taking its place, as the page
 *   loading the current season again on its return
 * @property {number | null} year
 */

/**
 * Shows each season a viewer picks with `reader`, keeping the pick with `keepPick` while its record
 * is on its way. Each pick settles only once the reader has no read out, as when the page's own
 * load of the current season is out too. A pick the page doesn't then show, unless a newer pick has
 * taken its place, keeps the season the page shows instead, or, before one has loaded, the pick
 * before the picks still on their way. One whose record couldn't be read, with nothing else shown
 * meanwhile, says the store can't be reached with `noteUnreachable`.
 * @template {number | null} PickedYear
 * @param {{
 *   reader: Pick<ReturnType<typeof createSeasonReader>, "showYear" | "readShownYear" | "waitForReads">,
 *   readPick: () => PickedYear,
 *   keepPick: (year: PickedYear | number) => void,
 *   noteUnreachable: () => void,
 * }} options
 * @returns {(year: number) => Promise<PickOutcome>}
 */
export function createSeasonPicks({ reader, readPick, keepPick, noteUnreachable }) {
  /** @type {number | null} */
  let latestPick = null;
  let picksOut = 0;
  let pickBefore = readPick();
  return async (year) => {
    if (picksOut === 0) pickBefore = readPick();
    picksOut++;
    latestPick = year;
    keepPick(year);
    const shownBefore = reader.readShownYear();
    const isRead = await reader.showYear(year).then(
      () => true,
      () => false,
    );
    await reader.waitForReads();
    picksOut--;
    if (latestPick !== year) return { kind: "replaced", year: latestPick };
    const shown = reader.readShownYear();
    if (shown === year) return { kind: "shown", year };
    const kept = shown ?? pickBefore;
    keepPick(kept);
    if (isRead || shown !== shownBefore) return { kind: "overtaken", year: kept };
    noteUnreachable();
    return { kind: "unread", year: kept };
  };
}
