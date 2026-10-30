import { GAME_PREFIXES } from "../../../page/js/snapshot.js";

/** @param {string} id */
export function readGameFacts(id) {
  const match = /^(10[1-5])(\d{2})\d{5}$/.exec(String(id));
  if (!match) return {};
  return {
    season: 2000 + Number(match[2]),
    isCupFinal: match[1] === GAME_PREFIXES.cupFinal,
  };
}
