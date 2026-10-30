import { identityPolicy } from "./identity-policy.js";
import { createReadDetail } from "./detail-reads.js";
import { OFF_DAY_CHECK_MS } from "#shared/poll-schedule.js";
import { choosePollDelay, listReminderGames } from "./adapters/mlb.js";
import PAGE_FILES from "#page-files/mlb";
import { readReleaseCommit } from "../../../../shared/worker/app-worker.js";
import { createSeasonStore } from "../../../../shared/worker/season-store.js";
import { GAME_DETAILS_COLLECTION } from "./adapters/box-score.js";
import { createMlbGameDetailsJob } from "./game-details-updater.js";
import { createHighlightsUpdater } from "./highlights-updater.js";
import { createMlbNewsJob } from "./news-updater.js";
import { findNotableUpdates, listNotifications } from "./notifications.js";
import { createPastSeasonsJob } from "./past-seasons.js";
import { PITCHER_JOB, createPitcherJob } from "./pitcher-updater.js";
import { createRosterJob } from "./roster-updater.js";
import * as SeasonUpdater from "./season-updater.js";
import { createSnapshotLoader } from "./snapshot.js";
import { createWatchedGameLoader } from "./watched-games.js";

export { forwardToStore, readStoreHealth } from "../../../../shared/worker/season-store.js";

/**
 * @type {import("../../../../shared/worker/season-store.js").League<
 *   ReturnType<typeof import("./adapters/mlb.js").buildSnapshot>,
 *   Awaited<ReturnType<typeof SeasonUpdater.readUpdates>>
 * >}
 */
const league = {
  identity: identityPolicy,
  release: readReleaseCommit(PAGE_FILES),
  createLoadSnapshot: (storage, fetchImpl) =>
    createSnapshotLoader({ storage, fetchImpl }).loadSnapshot,
  loadCurrentSnapshot: SeasonUpdater.loadCurrentSnapshot,
  readUpdates: SeasonUpdater.readUpdates,
  saveSnapshot: SeasonUpdater.saveSnapshot,
  describeSnapshotStatus: SeasonUpdater.describeSnapshotStatus,
  choosePollDelay: (snapshot, now) => choosePollDelay(snapshot, now) ?? OFF_DAY_CHECK_MS,
  listNotifications: ({ before, after, snapshot, now }) => {
    const updates = findNotableUpdates({ before, after, state: snapshot, now });
    const context = { teams: snapshot.teams, standings: snapshot.standings };
    return updates.length ? listNotifications(updates, context) : [];
  },
  listReminderGames,
  detailsCollection: GAME_DETAILS_COLLECTION,
  createLoadDetails: (options) => createWatchedGameLoader(options),
  createReadDetail,
  backgroundJobs: {
    games: createMlbGameDetailsJob(),
    highlights: createHighlightsUpdater(),
    pastSeasons: createPastSeasonsJob(),
    [PITCHER_JOB]: createPitcherJob(),
    rosters: createRosterJob(),
    news: createMlbNewsJob(),
  },
};

export const SeasonStore = createSeasonStore(league);
