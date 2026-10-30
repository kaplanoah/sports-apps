import { readGameFacts } from "./game-facts.js";
import { findTeamCodeByEspnId } from "../../../page/js/teams.js";
import { describeEspnBoxScore as describeBoxScore } from "../../../../../shared/worker/espn-adapter.js";
export { isFromEspn } from "../../../../../shared/worker/espn-adapter.js";

/** @param {any} summary @param {string} id @param {any} index */
export function describeEspnBoxScore(summary, id, index) {
  const boxScore = describeBoxScore(summary, id, index, findTeamCodeByEspnId);
  return boxScore ? { ...boxScore, ...readGameFacts(id) } : null;
}
