import { readSeriesFacts } from "../../page/js/snapshot.js";
import { nameEspnMatchKey } from "./adapters/lead.js";
import { nameNetworkMonthKey } from "./network-storage.js";
import { nameStoredFeedKey } from "../../../../shared/worker/feed-keeper.js";
import { readGameFacts } from "./adapters/game-facts.js";
import { readIdentityGames } from "../../../../shared/worker/espn-adapter.js";
import { findTeamCodeByEspnId } from "../../page/js/teams.js";

const NETWORK_PREFIX = nameStoredFeedKey(nameNetworkMonthKey(""));

/** @type {import("../../../../shared/worker/identity-documents.js").IdentityPolicy} */
export const identityPolicy = {
  league: "wnba",
  vendor: "wnba",
  gameFactFields: ["season", "isCupFinal"],
  nameMatchKey: nameEspnMatchKey,
  readGameFacts: (game, season) => ({ ...(season && { season }), ...readGameFacts(game.id) }),
  readSeriesFacts,
  vendorGameSourcePrefix: NETWORK_PREFIX,
  readSavedVendorGames: (key, value, limit) =>
    key.startsWith(NETWORK_PREFIX)
      ? readIdentityGames([value?.data], findTeamCodeByEspnId, limit)
      : null,
};
