// Where the store keeps each game's box score and lead.
export const GAME_DETAILS_COLLECTION = "games";

/** @param {string} id */
export const nameGameDetailsKey = (id) => `${GAME_DETAILS_COLLECTION}/${id}`;
