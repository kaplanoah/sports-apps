import { readSeriesFacts } from "../../page/js/bracket-rules.js";

/** @type {import("../../../../shared/worker/identity-documents.js").IdentityPolicy} */
export const identityPolicy = {
  league: "mlb",
  vendor: "mlb",
  readGameFacts: (game, season) => ({
    ...(season && { season }),
    ...(game.series && readSeriesFacts(game.series)),
    ...((game.doubleheader ?? game.gameNumber) > 1 && {
      gameNumber: game.doubleheader ?? game.gameNumber,
    }),
  }),
  readSeriesFacts,
};
