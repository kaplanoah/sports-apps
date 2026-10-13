import { hasCurrentSchedule, savePastSeason } from "./season-updater.js";

// Fills in each season before the current one that the store keeps without its standings, as one
// followed only until it ended was, or without its games as the page reads them now, as one saved
// before the store kept them, or before they held what they hold now, was, so the page reads every
// season whole from the store. One season a run, newest first, and once a past season is whole, it
// isn't read again. A season MLB answers only in part is left for the next run, and the run goes
// on to the next season.

const DAY_MS = 24 * 60 * 60 * 1000;

const hasStandings = (season) => !!season.standings;

/** @param {any} snapshot */
const isWholeSnapshot = (snapshot) => !snapshot.missing.length && !!snapshot.schedule;

/** @returns {import("../../../../shared/worker/season-store.js").BackgroundJob} */
export function createPastSeasonsJob() {
  return {
    chooseDelay: () => DAY_MS,
    async updateStore({ docs, loadSnapshot }) {
      const current = await docs.read("live/current");
      if (!current) return;
      const past = (await docs.list("seasons"))
        .filter((season) => season.year < current.season)
        .sort((first, second) => second.year - first.year);
      for (const season of past) {
        if (hasStandings(season) && (await hasCurrentSchedule(docs, season.year))) continue;
        const snapshot = await loadSnapshot(season.year);
        if (!isWholeSnapshot(snapshot)) continue;
        await savePastSeason(docs, snapshot);
        return;
      }
    },
  };
}
