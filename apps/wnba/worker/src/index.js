import PAGE_FILES from "#page-files/wnba";
import { createAppWorker } from "../../../../shared/worker/app-worker.js";
import { createBoxScoreServer } from "./box-score.js";
import { createHighlightsServer } from "./highlights.js";
import { createLeadServer } from "./lead.js";
import { createPlayerServer } from "./player.js";
import { LEAGUE_READS_COUNT, PLAYER_JOB } from "./player-updater.js";
import { createPreviewServer } from "./preview.js";
import { createRosterServer } from "./roster.js";
import {
  SeasonStore,
  addToJobCount,
  forwardToStore,
  isStoreAnswering,
  readStoreDoc,
} from "./store.js";

const boxScores = createBoxScoreServer();
const highlights = createHighlightsServer();
const leads = createLeadServer();
const previews = createPreviewServer();
const rosters = createRosterServer();
const players = createPlayerServer({ loadRoster: rosters.loadRoster });

export default createAppWorker({
  pageFiles: PAGE_FILES,
  forwardToStore,
  isStoreAnswering,
  isMovingToPageHost: true,
  reads: {
    "/box-score": (url, env) => boxScores.serveBoxScore(url, (key) => readStoreDoc(env, key)),
    "/highlights": (url, env) => highlights.serveHighlights(url, (key) => readStoreDoc(env, key)),
    "/lead": (url, env) => leads.serveLead(url, (key) => readStoreDoc(env, key)),
    "/player": (url, env) =>
      players.servePlayer(
        url,
        (key) => readStoreDoc(env, key),
        () => addToJobCount(env, PLAYER_JOB, LEAGUE_READS_COUNT),
      ),
    "/preview": (url, env) => previews.servePreview(url, (key) => readStoreDoc(env, key)),
    "/roster": (url, env) => rosters.serveRoster(url, (key) => readStoreDoc(env, key)),
  },
});

export { SeasonStore };
