import { readSeriesFacts } from "../../page/js/snapshot.js";
import { nameEspnMatchKey } from "./adapters/lead.js";
import { nameNetworkMonthKey } from "./network-storage.js";
import { nameStoredFeedKey } from "../../../../shared/worker/feed-keeper.js";
import { readGameFacts } from "./adapters/game-facts.js";
import { readIdentityGames } from "../../../../shared/worker/espn-adapter.js";
import { findTeamCodeByEspnId } from "../../page/js/teams.js";

/** @type {import("../../../../shared/worker/identity-documents.js").IdentityPolicy} */
export const identityPolicy = {
  league: "wnba",
  vendor: "wnba",
  nameMatchKey: nameEspnMatchKey,
  readGameFacts: (game, season) => ({ ...(season && { season }), ...readGameFacts(game.id) }),
  readSeriesFacts,
  readSavedVendorGames: (key, value) =>
    key.startsWith(nameStoredFeedKey(nameNetworkMonthKey("")))
      ? readIdentityGames([value?.data], findTeamCodeByEspnId)
      : null,
};
