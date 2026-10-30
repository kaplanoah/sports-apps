import { readGameFacts } from "./game-facts.js";
import { findTeamCodeByEspnId } from "../../../page/js/teams.js";
import { describeEspnBoxScore as describeBoxScore } from "../../../../../shared/worker/espn-adapter.js";
export { isFromEspn } from "../../../../../shared/worker/espn-adapter.js";

/** @param {any} summary @param {string} id @param {any} index */
export const describeEspnBoxScore = (summary, id, index) => ({
  ...describeBoxScore(summary, id, index, findTeamCodeByEspnId),
  ...readGameFacts(id),
});
