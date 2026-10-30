import { PITCHER_JOB } from "./pitcher-updater.js";
import { createDetailReads } from "../../../../shared/worker/detail-reads.js";
import { createBoxScoreServer } from "./box-score.js";
import { createHighlightsServer } from "./highlights.js";
import { nameGameDetailsKey } from "./adapters/box-score.js";
import { nameHighlightsKey } from "./adapters/highlights.js";
import { createPitcherServer } from "./pitchers.js";
import { createRotationServer } from "./rotations.js";

export const DETAIL_READS = {
  "/box-score": {
    parameters: ["id"],
    read: (services, url) => services.boxScore.serveBoxScore(url, services.docs.read),
    nameKey: (url) => nameGameDetailsKey(url.searchParams.get("id")),
  },
  "/highlights": {
    parameters: ["id", "season"],
    read: (services, url) => services.highlights.serveHighlights(url, services.docs.read),
    nameKey: (url) => nameHighlightsKey(url.searchParams.get("id")),
  },
  "/pitcher": {
    parameters: ["id", "season"],
    read: (services, url) =>
      services.pitcher.servePitcher(url, services.docs.read, services.countRead),
  },
  "/rotation": {
    parameters: ["club", "date"],
    read: (services, url) =>
      services.rotation.serveRotation(url, services.docs.read, services.countRead),
  },
};

/** @param {import("../../../../shared/worker/season-store.js").DetailContext} context */
export function createReadDetail({ docs, fetchImpl, now, storage, countLeagueRead }) {
  const services = {
    docs,
    boxScore: createBoxScoreServer({ fetchImpl }),
    highlights: createHighlightsServer({ fetchImpl, now }),
    pitcher: createPitcherServer({ fetchImpl, now }),
    rotation: createRotationServer({ fetchImpl, now }),
    countRead: () => countLeagueRead(PITCHER_JOB),
  };
  return createDetailReads(DETAIL_READS, { storage, now, docs, services });
}
