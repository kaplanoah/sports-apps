// Stable name comparison shared by vendor adapters and identity reconciliation.
/** The letters of a name, ignoring case, accents, spaces and punctuation.
 * @param {string} name
 */
export const readNameLetters = (name) =>
  name
    .normalize("NFD")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();

/** @param {{ firstName?: string, lastName?: string }} player */
export const readPlayerName = (player) =>
  readNameLetters(`${player.firstName ?? ""} ${player.lastName ?? ""}`);
