/** @param {string} id */
const readSeriesFacts = (id) => {
  const match = /^(?:(AL|NL)_)?(WC|DS|CS|WS)\d?$/.exec(id);
  return match ? { league: match[1] ?? null, round: match[2] } : {};
};

/** @type {import("../../../../shared/worker/identity-documents.js").IdentityPolicy} */
export const identityPolicy = {
  league: "mlb",
  vendor: "mlb",
  readGameFacts: (game, season) => ({
    ...(season && { season }),
    ...(game.series && readSeriesFacts(game.series)),
    ...((game.doubleheader ?? game.gameNumber) != null && {
      gameNumber: game.doubleheader ?? game.gameNumber,
    }),
  }),
  readSeriesFacts,
};
