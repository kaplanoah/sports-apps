import { readGameFacts } from "./adapters/game-facts.js";
import { readIdentityGames } from "../../../../shared/worker/espn-adapter.js";
import { findTeamCodeByEspnId } from "../../page/js/teams.js";

/** @type {import("../../../../shared/worker/identity-documents.js").IdentityPolicy} */
export const identityPolicy = {
  league: "wnba",
  vendor: "wnba",
  readGameFacts: (game, season) => ({ ...(season && { season }), ...readGameFacts(game.id) }),
  readSeriesFacts: (id) => {
    const match = /^([1-3])-(\d)$/.exec(id);
    return match ? { round: Number(match[1]) } : {};
  },
  readSavedVendorGames: (key, value) =>
    key.startsWith("feed:networks:") ? readIdentityGames([value?.data], findTeamCodeByEspnId) : [],
};
