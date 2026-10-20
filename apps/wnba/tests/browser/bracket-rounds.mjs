import { expect } from "@playwright/test";

/**
 * The afternoon's season with every first-round series over: the 8-seed Liberty win the upper
 * series and play the Semifinals under the 4-seed Dream, who host.
 * @param {any} season
 */
export function finishFirstRound(season) {
  const findSeries = (id) => season.series.find((series) => series.id === id);
  const finish = (id, side) => {
    const series = findSeries(id);
    series.winner = series[side].team;
    series[side].wins = 2;
  };
  finish("1-1", "top");
  finish("1-2", "bottom");
  finish("1-3", "top");
  Object.assign(findSeries("2-0"), {
    top: { team: "ATL", seed: 4, wins: 0 },
    bottom: { team: "NYL", seed: 8, wins: 0 },
  });
  Object.assign(findSeries("2-1"), {
    top: { team: "GSV", seed: 2, wins: 0 },
    bottom: { team: "IND", seed: 6, wins: 0 },
  });
  return season;
}

/**
 * Has the store finish the first round, and waits for the bracket to show the Semifinals' teams.
 * @param {import("@playwright/test").Page} page
 * @param {{ changeSeason: (change: (season: any) => any) => Promise<unknown> }} app
 */
export async function showFirstRoundFinished(page, app) {
  await app.changeSeason(finishFirstRound);
  await expect(page.locator('[data-series="2-1"] .team-line').first()).toContainText("Valkyries");
}

/**
 * The season with both Semifinals over too, so the Finals are the round still playing.
 * @param {any} season
 */
export function finishSemifinals(season) {
  finishFirstRound(season);
  const findSeries = (id) => season.series.find((series) => series.id === id);
  Object.assign(findSeries("2-0"), { winner: "NYL" });
  Object.assign(findSeries("2-0").bottom, { wins: 3 });
  Object.assign(findSeries("2-1"), { winner: "GSV" });
  Object.assign(findSeries("2-1").top, { wins: 3 });
  Object.assign(findSeries("3-0"), {
    top: { team: "GSV", seed: 2, wins: 0 },
    bottom: { team: "NYL", seed: 8, wins: 0 },
  });
  return season;
}
