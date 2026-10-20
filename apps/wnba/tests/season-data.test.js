import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSeason, showYear, startSeasonData } from "../page/js/season-data.js";
import { session } from "../page/js/session.js";

// A stand-in for the store: a read answers with what's stored, or fails for a path the test names,
// and a watch answers once the test moves on.
function createStore(documents, { unreadable = [] } = {}) {
  const readStored = (path) => ({
    id: path.split("/").pop(),
    exists: path in documents,
    data: () => documents[path],
  });
  return {
    doc: (path) => ({
      get: async () => {
        if (unreadable.includes(path)) throw new Error("unreadable");
        return readStored(path);
      },
      onSnapshot: (onNext) => {
        queueMicrotask(() => onNext(readStored(path)));
        return () => {};
      },
    }),
  };
}

const SEASON_2026 = { season: 2026, games: [], series: [], standings: [] };

/** @param {{ unreadable?: string[] }} [options] */
function startReading(options) {
  session.db = /** @type {any} */ (
    createStore({ "live/current": { season: 2026 }, "seasons/2026": SEASON_2026 }, options)
  );
  startSeasonData({
    showChange: () => {},
    showStamp: () => {},
    showCurrentYear: () => {},
    showUnreadable: () => {},
  });
}

beforeEach(() => {
  Object.assign(session, {
    season: null,
    problem: "",
    year: 2026,
    pickedYear: null,
    currentYear: null,
  });
});

test("picking a season that can't be read puts back the pick before it and says the store can't be reached", async () => {
  startReading({ unreadable: ["seasons/2025"] });
  await loadSeason();

  assert.equal(await showYear(2025), false);

  assert.deepEqual([session.year, session.pickedYear], [2026, 2026]);
  assert.deepEqual(session.season, SEASON_2026);
  assert.notEqual(session.problem, "");
});

test("a pick that can't be read after a newer pick replaced it leaves the newer one, with no problem", async () => {
  startReading({ unreadable: ["seasons/2025"] });
  await loadSeason();

  const replaced = showYear(2025);
  const newer = showYear(2026);

  assert.equal(await replaced, true);
  assert.equal(await newer, true);
  assert.equal(session.pickedYear, 2026);
  assert.equal(session.problem, "");
});
