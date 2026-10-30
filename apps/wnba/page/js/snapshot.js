// The app-owned season format and playoff rules read by pages and the Worker.

export const SNAPSHOT_VERSION = 1;

// Every game of a season keeps a document of its own, which only the Games view reads, so the
// season's record that pages watch through every live game doesn't carry it.
/** @param {number} year */
export const nameScheduleKey = (year) => `schedules/${year}`;

export const ROUNDS = {
  1: { name: "First Round", shortName: "1st Rd", bestOf: 3 },
  2: { name: "Semifinals", shortName: "Semis", bestOf: 5 },
  3: { name: "WNBA Finals", shortName: "Finals", bestOf: 7 },
};
/** @param {number} round */
export const countWinsNeeded = (round) => Math.ceil(ROUNDS[round].bestOf / 2);

/** @param {{ id: string }} game */
export const isCupFinal = (game) => /^105/.test(game.id);
