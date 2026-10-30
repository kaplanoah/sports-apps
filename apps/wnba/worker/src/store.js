import { choosePollDelay as chooseGamePollDelay, listReminderGames } from "./adapters/wnba.js";
import PAGE_FILES from "#page-files/wnba";
import { readReleaseCommit } from "../../../../shared/worker/app-worker.js";
import { createSeasonStore } from "../../../../shared/worker/season-store.js";
import { FAILED_FEED_WAIT_MS } from "../../../../shared/worker/feed-keeper.js";
import * as SeasonUpdater from "./season-updater.js";
import { createWnbaGameDetailsJob } from "./game-details-updater.js";
import { createHighlightsUpdater } from "./highlights-updater.js";
import { createWnbaNewsJob } from "./news-updater.js";
import { PLAYER_JOB, createPlayerJob } from "./player-updater.js";
import { createSnapshotLoader, SLOW_FEEDS } from "./snapshot.js";
import { GAME_DETAILS_COLLECTION } from "./store-docs.js";
import { createWatchedGameLoader } from "./watched-games.js";

export {
  addToJobCount,
  forwardToStore,
  readFeedFailures,
  readStoreDoc,
} from "../../../../shared/worker/season-store.js";

/**
 * @param {ReturnType<typeof import("./adapters/wnba.js").buildSnapshot> & import("../../../../shared/worker/season-store.js").SeasonSnapshot} snapshot
 * @param {number} now
 */
function choosePollDelay(snapshot, now) {
  const delay = chooseGamePollDelay(snapshot, now);
  const hasFailedSlowFeed = Object.keys(SLOW_FEEDS).some(
    (name) => name in (snapshot.failures ?? {}),
  );
  return hasFailedSlowFeed ? Math.min(delay, FAILED_FEED_WAIT_MS) : delay;
}

/**
 * @type {import("../../../../shared/worker/season-store.js").League<
 *   ReturnType<typeof import("./adapters/wnba.js").buildSnapshot>,
 *   Awaited<ReturnType<typeof SeasonUpdater.readUpdates>>
 * >}
 */
const league = {
  release: readReleaseCommit(PAGE_FILES),
  createLoadSnapshot: (storage, fetchImpl) =>
    createSnapshotLoader({ storage, fetchImpl }).loadSnapshot,
  loadCurrentSnapshot: SeasonUpdater.loadCurrentSnapshot,
  readUpdates: SeasonUpdater.readUpdates,
  saveSnapshot: SeasonUpdater.saveSnapshot,
  describeSnapshotStatus: SeasonUpdater.describeSnapshotStatus,
  listFeedFailures: SeasonUpdater.listFeedFailures,
  statusFields: SeasonUpdater.STATUS_FIELDS,
  choosePollDelay,
  listNotifications: SeasonUpdater.listNotifications,
  listReminderGames,
  detailsCollection: GAME_DETAILS_COLLECTION,
  createLoadDetails: () => createWatchedGameLoader(),
  backgroundJobs: {
    games: createWnbaGameDetailsJob(),
    highlights: createHighlightsUpdater(),
    news: createWnbaNewsJob(),
    [PLAYER_JOB]: createPlayerJob(),
  },
};

export const SeasonStore = createSeasonStore(league);
