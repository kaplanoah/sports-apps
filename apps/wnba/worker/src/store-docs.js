// Where the store keeps each game's box score and lead.
export const GAME_DETAILS_COLLECTION = "games";
export const GAME_DETAIL_FIELDS = ["boxScore", "lead"];

/** @param {string} id */
export const nameGameDetailsKey = (id) => `${GAME_DETAILS_COLLECTION}/${id}`;
