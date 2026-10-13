// Which game days a long list draws whole: those within a few screens of what it shows, and of a
// day it's sent to. A league with many games a day hands over a stand-in for each day, as tall as
// its games, which the list draws for the rest, so it holds only the games near the screen, and a
// day drawn whole or as a stand-in moves nothing.

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {import("./day-strip.js").ListedDay} ListedDay */

// Days within this many screens are drawn whole, which is more than a fling reaches before the
// list's next frame draws its own. Before the list is laid out, as on another tab, the days this
// many either side of the day it opens on are.
const NEAR_SCREENS = 3;
const NEAR_DAY_COUNT = 4;

/** @param {ListedDay[]} days */
export const hasStandIns = (days) => days.some(({ farMarkup }) => farMarkup);

/**
 * The days either side of `center`, for a list not yet laid out.
 * @param {ListedDay[]} days
 * @param {string} center
 */
export function listDaysAround(days, center) {
  const index = days.findIndex(({ day }) => day === center);
  const around =
    index < 0 ? [] : days.slice(Math.max(0, index - NEAR_DAY_COUNT), index + NEAR_DAY_COUNT + 1);
  return new Set(around.map(({ day }) => day));
}

/**
 * The days within a few screens of any of `tops`, each a scroll position in the list.
 * @param {HTMLElement} list
 * @param {ListedDay[]} days
 * @param {number[]} tops
 * @param {(day: string) => HTMLElement | null} findDay the element a day is drawn in
 */
export function measureNearDays(list, days, tops, findDay) {
  const reach = NEAR_SCREENS * list.clientHeight;
  const spans = tops.map((top) => [top - reach, top + list.clientHeight + reach]);
  /** @param {string} day */
  const isNear = (day) => {
    const listed = findDay(day);
    if (!listed) return false;
    const bottom = listed.offsetTop + listed.offsetHeight;
    return spans.some(([from, to]) => bottom > from && listed.offsetTop < to);
  };
  return new Set(days.filter(({ day }) => isNear(day)).map(({ day }) => day));
}

/**
 * What a list draws for a day: its games, or its stand-in while it's far from what shows.
 * @param {ListedDay} listed
 * @param {Set<string>} nearDays
 * @returns {Markup}
 */
export const chooseDayMarkup = ({ day, markup, farMarkup }, nearDays) =>
  farMarkup && !nearDays.has(day) ? farMarkup : markup;
