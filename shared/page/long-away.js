// After two minutes away, the page starts over where a viewer moved it, as a phone's apps do, but
// on the tab it showed: the page and each list at their tops, the season's standings and bracket on
// the part the tab is named for, a bracket on its opening round, the Games list on today, and a
// search and settings closed. Two minutes is long enough to glance at another app and come back to
// where the page was, and short enough that the next sitting starts over. This plain script loads
// in the head, before the scripts that put back what the page last showed, and the page's modules
// read it too.

const START_AFTER_AWAY_MS = 2 * 60 * 1000;

/** @param {number} awayMs */
const isAwayLong = (awayMs) => awayMs >= START_AFTER_AWAY_MS;

/**
 * Whether the page left the screen at `savedAt` two minutes or more before `now`, or at a time it
 * can't tell.
 * @param {unknown} savedAt
 * @param {number} [now]
 */
const isLongAwayFrom = (savedAt, now = Date.now()) =>
  !(now - Number(savedAt) < START_AFTER_AWAY_MS);

/**
 * Where a part the page draws whole shows again on a reload, from what the page saved of it as it
 * left the screen (last-seen.js): as it was, or, two minutes or more later, from its start, with
 * what it holds scrolled to its start, its holder and the page at their tops, its tabs on the
 * first, and only the classes its markup gives it, since its code's say where it was scrolled. A
 * list that names where it starts, like the Games list's start day or a sideways bracket's
 * opening round, goes there, and a part that starts hidden, like a search, is hidden again. A part
 * in a sheet stays where it was as long as the sheet does (sheet-memory.js).
 * @param {{ hidden?: unknown, scrolls?: unknown, holderTop?: unknown, pageTop?: unknown, classes?: unknown, savedAt?: unknown }} saved
 * @param {{ isInSheet: boolean, isStartHidden: boolean }} where
 * @param {number} now when the page loads, read once for all its parts, so they start over together
 */
function findPlaceToShow(
  { hidden, scrolls, holderTop, pageTop, classes, savedAt },
  { isInSheet, isStartHidden },
  now,
) {
  const isLongAway = isLongAwayFrom(savedAt, now);
  const isStartedOver = isLongAway && !isInSheet;
  /** @param {{ path?: unknown, left?: unknown, top?: unknown, startLeft?: unknown, startTop?: unknown }} scroll */
  const placeScroll = ({ path, left, top, startLeft, startTop }) => {
    const isOnStart = isLongAway && startTop !== undefined;
    const shownTop = isOnStart ? startTop : isStartedOver ? 0 : top;
    return {
      path,
      left: Number(isStartedOver ? startLeft : left) || 0,
      top: Number(shownTop) || 0,
      isOnStart,
    };
  };
  return {
    hidden: hidden === true || (isStartHidden && isLongAway),
    scrolls: Array.isArray(scrolls) ? scrolls.map(placeScroll) : [],
    holderTop: isStartedOver ? 0 : Number(holderTop) || 0,
    pageTop: isStartedOver ? 0 : Number(pageTop) || 0,
    classes: !isStartedOver && typeof classes === "string" ? classes : "",
    isOnFirstTab: isStartedOver,
  };
}
