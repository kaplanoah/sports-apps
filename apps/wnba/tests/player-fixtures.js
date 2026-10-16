import { readFileSync } from "node:fs";
import { describeAverages, listLeaders } from "../worker/src/season-averages.js";

// Every player's totals as the league answered the morning after the Liberty's last game.
const PLAYERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-players.json`, "utf8"),
);

/**
 * Every player's averages in 2026, and each team's leading scorers, as the store keeps them from
 * the season's totals.
 */
export function readSeasonAverages() {
  const averages = describeAverages(PLAYERS.totals[2026]);
  return { averages, leaders: listLeaders(averages) };
}

/**
 * Every player's game logs in a season as the league answers them in one read, from the few
 * players' logs a fixture recorded, keyed as 1627668:2026:Playoffs.
 * @param {Record<string, any>} gameLogs
 * @param {number} season
 * @param {string} seasonType
 */
export function joinGameLogs(gameLogs, season, seasonType) {
  const logs = Object.entries(gameLogs)
    .filter(([key]) => key.endsWith(`:${season}:${seasonType}`))
    .map(([, answer]) => answer.resultSets[0]);
  return {
    resultSets: [
      {
        name: "PlayerGameLogs",
        headers: logs[0].headers,
        rowSet: logs.flatMap((log) => log.rowSet),
      },
    ],
  };
}

/**
 * The league's answer with a turnovers column each row counts from its assists, for a fixture
 * recorded without one.
 * @param {any} answer
 */
export function addTurnovers(answer) {
  return {
    ...answer,
    resultSets: answer.resultSets.map((/** @type {any} */ table) => {
      const assists = table.headers.indexOf("AST");
      if (assists < 0 || table.headers.includes("TOV")) return table;
      return {
        ...table,
        headers: [...table.headers, "TOV"],
        rowSet: table.rowSet.map((/** @type {any[]} */ row) => [
          ...row,
          Math.round(row[assists] * 0.7),
        ]),
      };
    }),
  };
}
