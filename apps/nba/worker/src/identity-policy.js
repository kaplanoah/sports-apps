/** @typedef {ReturnType<typeof import("../../../../shared/worker/identity.js").createIdentityLookup>} IdentityLookup */

/** @param {IdentityLookup | null | undefined} lookup */
export function requireIdentityLookup(lookup) {
  if (!lookup) throw new Error("NBA identity lookup is not configured");
  return lookup;
}

const GAME_FACTS = ["season", "competition", "isCupFinal", "round", "gameNumber", "day"];

export const identityPolicy = {
  league: "nba",
  vendor: "nba",
  nativeIdMode: /** @type {const} */ ("internal"),
  gameFactFields: GAME_FACTS,
  readGameFacts: (game, season) =>
    Object.fromEntries(
      GAME_FACTS.map((field) => [
        field,
        field === "season" ? (game.season ?? season) : game[field],
      ]).filter(([, value]) => value !== undefined),
    ),
  readSeriesFacts: () => ({}),
};
