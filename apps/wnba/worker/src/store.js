import { choosePollDelay } from "../../page/js/snapshot.js";
import PAGE_FILES from "#page-files/wnba";
import { readReleaseCommit } from "../../../../shared/worker/app-worker.js";
import { createSeasonStore } from "../../../../shared/worker/season-store.js";
import * as SeasonUpdater from "./season-updater.js";
import { createWnbaGameDetailsJob } from "./game-details-updater.js";
import { createHighlightsUpdater } from "./highlights-updater.js";
import { createWnbaNewsJob } from "./news-updater.js";
import { PLAYER_JOB, createPlayerJob } from "./player-updater.js";
import { createSnapshotServer } from "./snapshot.js";
import { GAME_DETAILS_COLLECTION } from "./store-docs.js";
import { createWatchedGameLoader } from "./watched-games.js";

export {
  addToJobCount,
  forwardToStore,
  isStoreAnswering,
  readStoreDoc,
} from "../../../../shared/worker/season-store.js";

export const SeasonStore = createSeasonStore({
  release: readReleaseCommit(PAGE_FILES),
  createLoadSnapshot: (storage) => createSnapshotServer({ storage }).loadSnapshot,
  loadCurrentSnapshot: SeasonUpdater.loadCurrentSnapshot,
  readUpdates: SeasonUpdater.readUpdates,
  saveSnapshot: SeasonUpdater.saveSnapshot,
  describeSnapshotStatus: SeasonUpdater.describeSnapshotStatus,
  statusFields: SeasonUpdater.STATUS_FIELDS,
  choosePollDelay,
  listNotifications: SeasonUpdater.listNotifications,
  detailsCollection: GAME_DETAILS_COLLECTION,
  createLoadDetails: () => createWatchedGameLoader(),
  backgroundJobs: {
    games: createWnbaGameDetailsJob(),
    highlights: createHighlightsUpdater(),
    news: createWnbaNewsJob(),
    [PLAYER_JOB]: createPlayerJob(),
  },
});
