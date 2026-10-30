import { PLAYER_JOB } from "./player-updater.js";
import { createEspnGameReader } from "./adapters/lead.js";
import { createDetailReads } from "../../../../shared/worker/detail-reads.js";
import { createBoxScoreServer } from "./box-score.js";
import { createHighlightsServer } from "./highlights.js";
import { nameHighlightsKey } from "./adapters/highlights.js";
import { nameGameDetailsKey } from "./store-docs.js";
import { createLeadServer } from "./lead.js";
import { createPlayerServer } from "./player.js";
import { createPreviewServer } from "./preview.js";
import { createRosterServer } from "./roster.js";

const GAME_PARAMETERS = ["id", "away", "home", "start"];
export const DETAIL_READS = {
  "/box-score": {
    parameters: GAME_PARAMETERS,
    read: (services, url) => services.boxScore.serveBoxScore(url, services.docs.read),
    nameKey: (url) => nameGameDetailsKey(url.searchParams.get("id")),
    field: "boxScore",
  },
  "/highlights": {
    parameters: GAME_PARAMETERS,
    read: (services, url) => services.highlights.serveHighlights(url, services.docs.read),
    nameKey: (url) => nameHighlightsKey(url.searchParams.get("id")),
  },
  "/lead": {
    parameters: GAME_PARAMETERS,
    read: (services, url) => services.lead.serveLead(url, services.docs.read),
    nameKey: (url) => nameGameDetailsKey(url.searchParams.get("id")),
    field: "lead",
  },
  "/player": {
    parameters: ["id", "team", "season"],
    read: (services, url) =>
      services.player.servePlayer(url, services.docs.read, services.countRead),
  },
  "/preview": {
    parameters: ["away", "home", "season"],
    read: (services, url) => services.preview.servePreview(url, services.docs.read),
  },
  "/roster": {
    parameters: ["team", "season"],
    read: (services, url) => services.rosters.serveRoster(url, services.docs.read),
  },
};

/** @param {import("../../../../shared/worker/season-store.js").DetailContext} context */
export function createReadDetail({ docs, fetchImpl, now, storage, countLeagueRead }) {
  const espnGames = createEspnGameReader({ fetchImpl });
  const rosters = createRosterServer({ fetchImpl, now });
  const services = {
    docs,
    rosters,
    boxScore: createBoxScoreServer({ fetchImpl, espnGames }),
    highlights: createHighlightsServer({ fetchImpl, espnGames }),
    lead: createLeadServer({ fetchImpl, espnGames }),
    player: createPlayerServer({ fetchImpl, now, loadRoster: rosters.loadRoster }),
    preview: createPreviewServer({ fetchImpl, now }),
    countRead: () => countLeagueRead(PLAYER_JOB),
  };
  return createDetailReads(DETAIL_READS, { storage, now, docs, services });
}
