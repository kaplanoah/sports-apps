import PAGE_FILES from "#page-files/mlb";
import { createAppWorker } from "../../../../shared/worker/app-worker.js";
import { createBoxScoreServer } from "./box-score.js";
import { createHighlightsServer } from "./highlights.js";
import { LEAGUE_READS_COUNT, PITCHER_JOB } from "./pitcher-updater.js";
import { createPitcherServer } from "./pitchers.js";
import { createRotationServer } from "./rotations.js";
import {
  SeasonStore,
  addToJobCount,
  forwardToStore,
  isStoreAnswering,
  readStoreDoc,
} from "./store.js";

const boxScores = createBoxScoreServer();
const highlights = createHighlightsServer();
const pitchers = createPitcherServer();
const rotations = createRotationServer();

/** @param {any} env */
const createLeagueReadCounter = (env) => () => addToJobCount(env, PITCHER_JOB, LEAGUE_READS_COUNT);

export default createAppWorker({
  name: "mlb",
  pageFiles: PAGE_FILES,
  forwardToStore,
  isStoreAnswering,
  reads: {
    "/box-score": (url, env) => boxScores.serveBoxScore(url, (key) => readStoreDoc(env, key)),
    "/highlights": (url, env) => highlights.serveHighlights(url, (key) => readStoreDoc(env, key)),
    "/pitcher": (url, env) =>
      pitchers.servePitcher(url, (key) => readStoreDoc(env, key), createLeagueReadCounter(env)),
    "/rotation": (url, env) =>
      rotations.serveRotation(url, (key) => readStoreDoc(env, key), createLeagueReadCounter(env)),
  },
});

export { SeasonStore };
