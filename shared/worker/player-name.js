/** @param {string} name */
export const readNameLetters = (name) =>
  name
    .normalize("NFD")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();
