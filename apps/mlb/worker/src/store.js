import { OFF_DAY_CHECK_MS } from "#shared/poll-schedule.js";
import { choosePollDelay, listReminderGames } from "../../page/js/snapshot.js";
import PAGE_FILES from "#page-files/mlb";
import { readReleaseCommit } from "../../../../shared/worker/app-worker.js";
import { createSeasonStore } from "../../../../shared/worker/season-store.js";
import { GAME_DETAILS_COLLECTION } from "./box-score.js";
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

export {
  addToJobCount,
  forwardToStore,
  isStoreAnswering,
  readStoreDoc,
} from "../../../../shared/worker/season-store.js";

export const SeasonStore = createSeasonStore({
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
  createLoadDetails: () => createWatchedGameLoader(),
  backgroundJobs: {
    games: createMlbGameDetailsJob(),
    highlights: createHighlightsUpdater(),
    pastSeasons: createPastSeasonsJob(),
    [PITCHER_JOB]: createPitcherJob(),
    rosters: createRosterJob(),
    news: createMlbNewsJob(),
  },
});
