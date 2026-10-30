import * as MLBSnapshot from "./adapters/mlb.js";
import { guessSeasonYear } from "../../page/js/session.js";
import { fetchMlbJson, LIVE_FEED_CACHE_SECONDS } from "./mlb.js";
import { createFeedKeeper } from "../../../../shared/worker/feed-keeper.js";
import { describeError } from "../../../../shared/worker/responses.js";
import { createReusedLoader } from "../../../../shared/worker/upstream.js";

const EDGE_CACHE_SECONDS = 15; // under MLB's own 20-second cache
const SNAPSHOT_REUSE_MS = 10000;
const HOUR_MS = 60 * 60 * 1000;
// The schedule's games are read every time. The rest change as games end, when they're read
// again, and otherwise hardly at all: the season's dates a few times a year, the standings and
// the starters' numbers with each game, and the postseason as its games are set. The season's
// whole schedule changes only as games are moved, since the days around today, read every time,
// bring each game's end.
const SLOW_FEEDS = {
  season: { maxAgeMs: 24 * HOUR_MS, changesWithGames: false },
  seasonGames: { maxAgeMs: 24 * HOUR_MS, changesWithGames: false },
  standings: { maxAgeMs: 24 * HOUR_MS, changesWithGames: true },
  pitchers: { maxAgeMs: 24 * HOUR_MS, changesWithGames: true },
  postseason: { maxAgeMs: HOUR_MS, changesWithGames: true },
};

// Reads MLB for the store, and reads moments apart share one trip to MLB. A season before
// the one under way is over, so once it's read whole, it's kept.
/**
 * @param {object} [options]
 * @param {(input: string, init: object) => Promise<Response>} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {import("../../../../shared/worker/feed-keeper.js").FeedStorage} [options.storage]
 */
export function createSnapshotLoader({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
  storage = undefined,
} = {}) {
  const slowFeeds = createFeedKeeper({ feeds: SLOW_FEEDS, now, storage });

  const fetchFeed = async (path, name) => {
    const answer = await fetchMlbJson(fetchImpl, path, EDGE_CACHE_SECONDS);
    return MLBSnapshot.validateFeedResponse(name, answer);
  };

  async function fetchSchedule(path) {
    const schedule = await fetchFeed(path, "schedule");
    await slowFeeds.noteFinalCount(MLBSnapshot.countFinals(schedule));
    return schedule;
  }

  /**
   * @param {string} path
   * @param {string} name
   * @param {{ readAgain: boolean, onFailure: (reason: string) => void }} options
   */
  function fetchSnapshotJson(path, name, options) {
    if (name === "schedule") return fetchSchedule(path);
    if (name === "liveGame")
      return fetchMlbJson(fetchImpl, path, LIVE_FEED_CACHE_SECONDS).then((answer) =>
        MLBSnapshot.validateFeedResponse(name, answer),
      );
    if (Object.hasOwn(SLOW_FEEDS, name))
      return slowFeeds.readFeed(name, path, () => fetchFeed(path, name), options);
    return fetchFeed(path, name);
  }

  /**
   * The snapshot, with why each feed that failed did, by its name, for the store's health. A
   * verifying read reads the postseason again, and its kept answer stands in only when MLB
   * doesn't answer, since the days around today, read every time, hold each game a reminder can
   * be due for, and their word on a game replaces the postseason's.
   * @param {number} season
   * @param {number} requestedAt
   * @param {boolean} [verify]
   */
  async function fetchSnapshot(season, requestedAt, verify = false) {
    /** @type {Record<string, string>} */
    const failures = {};
    /** @param {string} path @param {string} name */
    function fetchNotingFailure(path, name) {
      /** @param {string} reason */
      const onFailure = (reason) => {
        failures[name] = reason;
      };
      const readAgain = verify && name === "postseason";
      return fetchSnapshotJson(path, name, { readAgain, onFailure }).catch((error) => {
        onFailure(describeError(error));
        throw error;
      });
    }
    const snapshot = await MLBSnapshot.fetchSnapshot(fetchNotingFailure, season, requestedAt);
    return { ...snapshot, failures };
  }
  const loadCurrentSnapshot = createReusedLoader(fetchSnapshot, SNAPSHOT_REUSE_MS, now);
  /** @type {Map<number, any>} */
  const pastSnapshots = new Map();

  /** @param {number} season */
  async function loadPastSnapshot(season) {
    if (pastSnapshots.has(season)) return pastSnapshots.get(season);
    const snapshot = await loadCurrentSnapshot(season);
    if (!snapshot.missing.length) pastSnapshots.set(season, snapshot);
    return snapshot;
  }

  /** @param {number} season @param {{ verify?: boolean }} [options] */
  const loadSnapshot = (season, { verify = false } = {}) => {
    if (verify) return fetchSnapshot(season, now(), true);
    return season < guessSeasonYear(now()) ? loadPastSnapshot(season) : loadCurrentSnapshot(season);
  };

  return { loadSnapshot };
}
