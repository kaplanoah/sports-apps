import { addDays, readEasternDay } from "#shared/days.js";
import { listStarterIds } from "./adapters/mlb.js";
import { fetchMlbJson } from "./mlb.js";
import {
  describePitcher,
  describeStarters,
  fetchPeople,
  listAppearancesRequest,
  listGameLogRequest,
  listPeopleRequest,
  listQualifiedIds,
  listQualifiedRequest,
  namePitcherKey,
  nameStartersKey,
  readLeagueRows,
  readSpeeds,
  splitIntoBatches,
} from "./pitchers.js";
import {
  LOOKBACK_DAYS,
  describeClubStarts,
  describeKeptRotationPitcher,
  listClubStarterIds,
  listScheduleClubs,
  listScheduleRequest,
  nameRotationKey,
} from "./rotations.js";
import {
  createPerStoreJob,
  createSavedDocs,
  createVersionForgetter,
  listPastSeasons,
  nameVersionedKey,
} from "../../../../shared/worker/background-job.js";
import { createFeedKeeper, isPlayerReadDue } from "../../../../shared/worker/feed-keeper.js";
import { catchFailure, noteFailure, runWithStatus } from "../../../../shared/worker/job-status.js";
import { nameCountKey } from "../../../../shared/worker/season-store.js";

// Keeps what the matchup sheet shows, so a tap reads only the store and never waits on MLB. Each
// run reads MLB's league-wide feeds again only as a game ends, or once they're old: every
// pitcher's games and starts in the regular season and the postseason, the qualified starters'
// numbers, and the last two weeks of every club's games. From those it finds the pitchers who have
// pitched since it last read them, and reads only those, a batch at a time, as a game ends and
// once more as his numbers settle. It keeps every pitcher who has started a game this season or is
// named to start one the page lists, the qualified starters he's ranked among, and each club's
// recent starts, and saves only the documents that changed. Each run also fills the qualified
// starters of one season the store keeps from before the current one, newest first, and a filled
// season is never read again, since a past season doesn't change. It saves how each run went, with
// how often a sheet still had to read MLB, in `pitchers/status`.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RUN_DELAY_MS = 5 * MINUTE_MS;
const STATUS_KEY = "pitchers/status";
export const PITCHER_JOB = "pitchers";
// The count the Worker adds to each time a sheet reads MLB for what the store should have kept.
export const LEAGUE_READS_COUNT = "leagueReads";
// Every starter's first read spreads over a few runs, while a game's end needs only one batch.
const BATCHES_PER_RUN = 4;

const FEEDS = {
  appearances: { maxAgeMs: 6 * HOUR_MS, changesWithGames: true },
  qualified: { maxAgeMs: 6 * HOUR_MS, changesWithGames: true },
  schedule: { maxAgeMs: 6 * HOUR_MS, changesWithGames: true },
};

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */
/** @typedef {import("../../../../shared/worker/job-status.js").RunContext} RunContext */
/** @typedef {import("../../../../shared/worker/feed-keeper.js").PlayerRead} PlayerRead */

/** @param {number} season */
const nameFilledKey = (season) => `filled:${season}`;

// Raised whenever a pitcher's saved side gains a field, so every kept side is read once more.
export const SIDE_VERSION = 2;

/**
 * @param {number} season
 * @param {number} [version] the saved sides' version
 */
export const nameReadsKey = (season, version = SIDE_VERSION) =>
  nameVersionedKey(`reads:${season}`, version);

/**
 * How many of the games on the page's last night and today have ended, which grows as each ends.
 * @param {any} savedSeason
 */
export function countSlateFinals(savedSeason) {
  const slate = savedSeason?.slate;
  if (!slate) return null;
  return [slate.lastNight, slate.today]
    .flatMap((day) => day?.games ?? [])
    .filter((/** @type {any} */ game) => game.state === "final").length;
}

/**
 * Each pitcher's games, regular season and postseason together, and whether he has started one.
 * @param {any[]} tables
 */
function countAppearances(tables) {
  /** @type {Map<number, { games: number, hasStarted: boolean }>} */
  const counts = new Map();
  for (const row of tables.flatMap(readLeagueRows)) {
    const counted = counts.get(row.player.id) ?? { games: 0, hasStarted: false };
    counts.set(row.player.id, {
      games: counted.games + (row.stat?.gamesPlayed ?? 0),
      hasStarted: counted.hasStarted || (row.stat?.gamesStarted ?? 0) > 0,
    });
  }
  return counts;
}

/** One store's update, with what it keeps between runs while it stays in memory. */
function createStoreUpdate() {
  /** @type {ReturnType<typeof createFeedKeeper> | null} */
  let keeper = null;
  const { readDoc, saveDoc } = createSavedDocs();
  const forgetEarlierVersions = createVersionForgetter();

  /**
   * @param {JobContext} context
   * @param {string} name which feed's limits apply
   * @param {string} key what the answer is kept under
   * @param {() => Promise<any>} load
   * @param {(answer: any) => boolean} [isBehind] whether a kept answer is behind
   */
  const readFeed = (context, name, key, load, isBehind) =>
    /** @type {ReturnType<typeof createFeedKeeper>} */ (keeper).readFeed(name, key, load, {
      isBehind,
    });

  /**
   * @param {JobContext} context
   * @param {string} path
   */
  const fetchJson = (context, path) => fetchMlbJson(context.fetchImpl, path, null);

  /**
   * The last two weeks of every club's games, through today, read again once today is a day the
   * last read didn't reach, so a club's starts reach today however long the night's been quiet.
   * @param {JobContext} context
   * @param {number} season
   */
  function readSchedule(context, season) {
    return readFeed(
      context,
      "schedule",
      String(season),
      async () => {
        const today = readEasternDay(context.now()).date;
        const from = addDays(today, -LOOKBACK_DAYS);
        const schedule = await fetchJson(context, listScheduleRequest(null, from, today));
        return { from, through: today, schedule };
      },
      (recent) => !(recent.through >= readEasternDay(context.now()).date),
    );
  }

  /**
   * @param {JobContext} context
   * @param {number} season
   */
  const readSeasonFeeds = (context, season) =>
    Promise.all([
      ...[listAppearancesRequest(season, "R"), listAppearancesRequest(season, "P")].map((path) =>
        readFeed(context, "appearances", path, () => fetchJson(context, path)),
      ),
      readFeed(context, "qualified", listQualifiedRequest(season), () =>
        fetchJson(context, listQualifiedRequest(season)),
      ),
      readSchedule(context, season),
    ]);

  /**
   * Reads one batch of pitchers and saves each one's side.
   * @param {JobContext} context
   * @param {number} season
   * @param {number[]} ids
   */
  async function updateBatch(context, season, ids) {
    const [people, gameLogs] = await Promise.all([
      fetchJson(context, listPeopleRequest(season, ids)),
      fetchJson(context, listGameLogRequest(season, ids)),
    ]);
    const gameLogsById = new Map(
      (gameLogs?.people || []).map((/** @type {any} */ person) => [person.id, person]),
    );
    for (const person of people?.people || [])
      await saveDoc(
        context.docs,
        namePitcherKey(season, person.id),
        describePitcher(person, gameLogsById.get(person.id)),
      );
  }

  /**
   * Reads and saves the pitchers who have pitched since they were last read, the qualified
   * starters first, and a few batches a run, and notes when each was read. A batch MLB doesn't
   * answer is read on a later run.
   * @param {RunContext} context
   * @param {number} season
   * @param {Map<number, number>} games each kept pitcher's games, by id, the qualified first
   */
  async function updatePitchers(context, season, games) {
    /** @type {Record<string, PlayerRead>} */
    const reads = (await context.storage.get(nameReadsKey(season))) ?? {};
    const due = [...games]
      .filter(([id, count]) => isPlayerReadDue(reads[id], count, context.now()))
      .map(([id]) => id);
    const batches = splitIntoBatches(due).slice(0, BATCHES_PER_RUN);
    if (!batches.length) return;
    const results = await Promise.allSettled(
      batches.map((batch) => updateBatch(context, season, batch)),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        noteFailure(context.failures, `Reading ${season}'s pitchers`, result.reason);
        continue;
      }
      for (const id of batches[index]) {
        const count = /** @type {number} */ (games.get(id));
        const isSettled = reads[id] === undefined || reads[id].games === count;
        reads[id] = { games: count, at: context.now(), isSettled };
      }
    }
    await context.storage.put(nameReadsKey(season), reads);
    await forgetEarlierVersions(
      context.storage,
      (version) => nameReadsKey(season, version),
      SIDE_VERSION,
    );
  }

  /**
   * The current season's qualified starters, each with the speed his saved side shows, or none
   * until a run saves his side.
   * @param {JobContext} context
   * @param {number} season
   * @param {any} qualified MLB's qualified starters
   */
  async function saveStarters(context, season, qualified) {
    const ids = listQualifiedIds(qualified);
    const pitchers = await Promise.all(
      ids.map((id) => readDoc(context.docs, namePitcherKey(season, id))),
    );
    const speeds = new Map(
      pitchers.filter(Boolean).map((pitcher) => [pitcher.id, pitcher.line?.speed ?? null]),
    );
    await saveDoc(context.docs, nameStartersKey(season), describeStarters(qualified, speeds));
  }

  /**
   * Each club's recent starts, saved only once every pitcher who made them is saved.
   * @param {JobContext} context
   * @param {number} season
   * @param {{ from: string, through: string, schedule: any }} recent
   */
  async function saveRotations(context, season, { from, through, schedule }) {
    for (const club of listScheduleClubs(schedule)) {
      const ids = listClubStarterIds(schedule, club);
      const sides = await Promise.all(
        ids.map((id) => readDoc(context.docs, namePitcherKey(season, id))),
      );
      if (sides.some((side) => !side)) continue;
      const pitchers = new Map(sides.map((side) => [side.id, describeKeptRotationPitcher(side)]));
      const clubStarts = describeClubStarts({ club, from, through, schedule, pitchers });
      await saveDoc(context.docs, nameRotationKey(season, club), clubStarts);
    }
  }

  /**
   * @param {RunContext} context
   * @param {number} season
   * @param {any} savedSeason the season's record, whose slate names the starters the page lists
   */
  async function updateCurrentSeason(context, season, savedSeason) {
    const [regular, postseason, qualified, recent] = await readSeasonFeeds(context, season);
    const counts = countAppearances([regular, postseason]);
    const keptIds = new Set([
      ...listQualifiedIds(qualified),
      ...listStarterIds(savedSeason?.slate),
      ...[...counts].filter(([, counted]) => counted.hasStarted).map(([id]) => id),
    ]);
    const games = new Map([...keptIds].map((id) => [id, counts.get(id)?.games ?? 0]));
    await updatePitchers(context, season, games);
    await saveStarters(context, season, qualified);
    await saveRotations(context, season, recent);
  }

  /**
   * Fills the qualified starters of the newest past season the store keeps that it hasn't filled.
   * @param {JobContext} context
   * @param {number} current
   */
  async function fillPastSeason(context, current) {
    for (const season of await listPastSeasons(context.docs, current)) {
      if (await context.storage.get(nameFilledKey(season))) continue;
      const qualified = await fetchJson(context, listQualifiedRequest(season));
      const people = await fetchPeople(
        (path) => fetchJson(context, path),
        (ids) => listPeopleRequest(season, ids),
        listQualifiedIds(qualified),
      );
      await saveDoc(
        context.docs,
        nameStartersKey(season),
        describeStarters(qualified, readSpeeds(people)),
      );
      await context.storage.put(nameFilledKey(season), true);
      return;
    }
  }

  /** @param {RunContext} context */
  async function keepPitchers(context) {
    keeper ??= createFeedKeeper({
      feeds: FEEDS,
      now: context.now,
      storage: context.storage,
    });
    const current = (await context.docs.read("live/current"))?.season;
    if (!Number.isInteger(current)) return;
    const savedSeason = await context.docs.read(`seasons/${current}`);
    await keeper.noteFinalCount(countSlateFinals(savedSeason));
    await catchFailure(context.failures, `Keeping ${current}'s pitchers`, () =>
      updateCurrentSeason(context, current, savedSeason),
    );
    await catchFailure(context.failures, "Filling a past season's starters", () =>
      fillPastSeason(context, current),
    );
  }

  /** @param {RunContext} context */
  const describeRun = async ({ storage }) => ({
    leagueReads: (await storage.get(nameCountKey(LEAGUE_READS_COUNT))) ?? 0,
  });

  /** @param {JobContext} context */
  const updateStore = (context) =>
    runWithStatus(context, { statusKey: STATUS_KEY, updateStore: keepPitchers, describeRun });

  return updateStore;
}

export const createPitcherJob = () => createPerStoreJob(RUN_DELAY_MS, createStoreUpdate);
