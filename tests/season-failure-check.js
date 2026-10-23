import assert from "node:assert/strict";

/**
 * Counts the app's problem reports and stamp redraws for each failed way of selecting a season.
 * @param {{ session: any, redraws: { stamps: number }, unreadable: string[],
 *   deliver: (path: string, data: any) => void, loadSeason: () => Promise<void>,
 *   showYear: (year: number) => Promise<void> }} options
 */
export async function checkSeasonFailureReports({
  session,
  redraws,
  unreadable,
  deliver,
  loadSeason,
  showYear,
}) {
  const descriptor = Object.getOwnPropertyDescriptor(session, "problem");
  let problem = session.problem;
  let reports = 0;
  Object.defineProperty(session, "problem", {
    configurable: true,
    get: () => problem,
    set: (value) => {
      problem = value;
      if (value) reports++;
    },
  });
  try {
    for (const fail of [
      async () => {
        unreadable.push("live/current");
        await loadSeason();
      },
      async () => {
        unreadable.push("seasons/2025");
        await showYear(2025);
      },
      async () => {
        unreadable.push("seasons/2027");
        deliver("live/current", { season: 2027 });
        await new Promise((resolve) => setImmediate(resolve));
      },
    ]) {
      reports = 0;
      redraws.stamps = 0;
      await fail();
      assert.deepEqual([reports, redraws.stamps], [1, 1]);
    }
  } finally {
    Object.defineProperty(session, "problem", descriptor);
  }
}
