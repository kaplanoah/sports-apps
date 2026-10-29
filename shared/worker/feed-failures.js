// Which of a league's feeds have been failing, and why, kept by the store from each update, so the
// Worker's health can say so before a fan notices. A feed counts as failing from the first of its
// failed reads in a row, and only once that's FEED_FAILURE_MS old, so a moment's blip, which the
// next read clears, never reaches the health.

export const FEED_FAILURE_MS = 15 * 60 * 1000;

/**
 * Since when a feed has failed, as an ISO time, and why it failed last.
 * @typedef {{ since: string, reason: string }} FeedFailure
 */

/**
 * The feeds failing after an update, each keeping when it began failing, from why each feed the
 * update read failed. A feed that answered, or that the update found no failure for, is dropped.
 * @param {Record<string, FeedFailure>} failing what the last update left
 * @param {Record<string, string>} failures why each feed that failed this time did
 * @param {number} now
 * @returns {Record<string, FeedFailure>}
 */
export function noteFeedFailures(failing, failures, now) {
  const at = new Date(now).toISOString();
  return Object.fromEntries(
    Object.entries(failures).map(([feed, reason]) => [
      feed,
      { since: failing[feed]?.since ?? at, reason },
    ]),
  );
}

/**
 * Why each feed failing does, as an update that read none of them finds them still failing.
 * @param {Record<string, FeedFailure>} failing
 * @returns {Record<string, string>}
 */
export const listFailureReasons = (failing) =>
  Object.fromEntries(Object.entries(failing).map(([feed, failure]) => [feed, failure.reason]));

/**
 * The feeds that have been failing for FEED_FAILURE_MS or longer.
 * @param {Record<string, FeedFailure>} failing
 * @param {number} now
 * @returns {Record<string, FeedFailure>}
 */
export const listLongFailures = (failing, now) =>
  Object.fromEntries(
    Object.entries(failing).filter(
      ([, failure]) => now - Date.parse(failure.since) >= FEED_FAILURE_MS,
    ),
  );
