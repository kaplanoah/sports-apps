import { GAME_PREFIXES } from "../../../page/js/snapshot.js";

const GAME_ID = new RegExp(`^(${Object.values(GAME_PREFIXES).join("|")})(\\d{2})\\d{5}$`);

/** @param {string} id */
export function readGameFacts(id) {
  const match = GAME_ID.exec(String(id));
  if (!match) return {};
  return {
    season: 2000 + Number(match[2]),
    isCupFinal: match[1] === GAME_PREFIXES.cupFinal,
  };
}
