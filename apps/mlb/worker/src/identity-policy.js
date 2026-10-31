import { readSeriesFacts } from "../../page/js/bracket-rules.js";

/** @type {import("../../../../shared/worker/identity-documents.js").IdentityPolicy} */
export const identityPolicy = {
  league: "mlb",
  vendor: "mlb",
  gameFactFields: ["season", "round", "league"],
  readGameFacts: (game, season) => ({
    ...(season && { season }),
    ...(game.series && readSeriesFacts(game.series)),
  }),
  readSeriesFacts,
};
