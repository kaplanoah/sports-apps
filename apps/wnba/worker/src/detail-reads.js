import { createEspnGameReader } from "./adapters/lead.js";
import { createDetailReads } from "../../../../shared/worker/detail-reads.js";
import { createBoxScoreServer } from "./box-score.js";
import { createHighlightsServer } from "./highlights.js";
import { createLeadServer } from "./lead.js";
import { createPlayerServer } from "./player.js";
import { createPreviewServer } from "./preview.js";
import { createRosterServer } from "./roster.js";

/** @param {import("../../../../shared/worker/season-store.js").JobContext} context */
export function createReadDetail(context) {
  const { docs, fetchImpl, now, storage } = context;
  const espnGames = createEspnGameReader({ fetchImpl });
  const rosters = createRosterServer({ fetchImpl, now });
  const boxScore = createBoxScoreServer({ fetchImpl, espnGames });
  const highlights = createHighlightsServer({ fetchImpl, espnGames });
  const lead = createLeadServer({ fetchImpl, espnGames });
  const player = createPlayerServer({ fetchImpl, now, loadRoster: rosters.loadRoster });
  const preview = createPreviewServer({ fetchImpl, now });
  return createDetailReads(
    {
      "/box-score": (url) => boxScore.serveBoxScore(url, docs.read),
      "/highlights": (url) => highlights.serveHighlights(url, docs.read),
      "/lead": (url) => lead.serveLead(url, docs.read),
      "/player": (url) => player.servePlayer(url, docs.read),
      "/preview": (url) => preview.servePreview(url, docs.read),
      "/roster": (url) => rosters.serveRoster(url, docs.read),
    },
    { storage, now },
  );
}
