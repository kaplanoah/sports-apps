// The app-owned season format and store paths, shared with the Worker without DOM or globals.

// Raise the version when a page can no longer read the season record's shape.
export const SNAPSHOT_VERSION = 1;

// The Games view lists every game of the season, which the store keeps a month to a document, apart
// from the season's record that pages follow through every live game, and saves again only as a
// game ends or the schedule changes.
/** @param {number} year */
export const nameScheduleCollection = (year) => `schedules-${year}`;

// What the schedule's games hold, raised whenever they hold more, so a past season saved before is
// read once more for it.
export const SCHEDULE_EDITION = 2;

/**
 * @param {number} year
 * @param {string} month "YYYY-MM"
 */
export const nameScheduleKey = (year, month) => `${nameScheduleCollection(year)}/${month}`;
