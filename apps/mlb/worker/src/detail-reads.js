import { PITCHER_JOB } from "./pitcher-updater.js";
import { createDetailReads } from "../../../../shared/worker/detail-reads.js";
import { createBoxScoreServer } from "./box-score.js";
import { createHighlightsServer } from "./highlights.js";
import { createPitcherServer } from "./pitchers.js";
import { createRotationServer } from "./rotations.js";

/** @param {import("../../../../shared/worker/season-store.js").DetailContext} context */
export function createReadDetail(context) {
  const { docs, fetchImpl, now, storage, countLeagueRead } = context;
  const boxScore = createBoxScoreServer({ fetchImpl });
  const highlights = createHighlightsServer({ fetchImpl });
  const pitcher = createPitcherServer({ fetchImpl, now });
  const rotation = createRotationServer({ fetchImpl, now });
  return createDetailReads(
    {
      "/box-score": (url) => boxScore.serveBoxScore(url, docs.read),
      "/highlights": (url) => highlights.serveHighlights(url, docs.read),
      "/pitcher": (url) => pitcher.servePitcher(url, docs.read, () => countLeagueRead(PITCHER_JOB)),
      "/rotation": (url) =>
        rotation.serveRotation(url, docs.read, () => countLeagueRead(PITCHER_JOB)),
    },
    { storage, now },
  );
}
