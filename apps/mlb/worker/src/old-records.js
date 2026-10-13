// Removes the live scores and standings the store once kept for each season apart from its record,
// which nothing reads now that the page reads the season from its record alone.

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {number} year */
const listOldKeys = (year) => [`live/${year}`, `standings/${year}`];

/** @returns {import("../../../../shared/worker/season-store.js").BackgroundJob} */
export function createOldRecordsJob() {
  return {
    chooseDelay: () => DAY_MS,
    async updateStore({ docs }) {
      const years = (await docs.list("seasons")).map((season) => season.year);
      for (const key of years.flatMap(listOldKeys)) {
        if (await docs.read(key)) await docs.remove(key);
      }
    },
  };
}
