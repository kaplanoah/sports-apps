// When what's above a list that scrolls grows or shrinks, like the Updates box opening, the list's
// scroll moves by as much, so the rows on the screen stay where they are, as Chrome's scroll
// anchoring does and Safari's doesn't, frame by frame as it eases. A list at its top stays there,
// so what opens above it shows. Each list the page keeps in place opts out of the browser's own
// anchoring (pager.css, and chrome.css for a view keepPagePlace marks), so it moves once, the same
// in every browser.

/**
 * Where a list scrolled to `top` goes when what's above it moves its rows down by `change`, or up
 * by a negative one.
 * @param {number} top
 * @param {number} change
 */
export const findKeptTop = (top, change) => (top < 1 ? top : Math.max(0, top + change));

/**
 * How far short of `wanted` a scroll that landed at `landed` fell, since a browser scrolls to
 * whole pixels, for the next change to carry so the rounding never adds up across an ease's
 * frames, or 0 for a pixel or more, where the list ends.
 * @param {number} wanted
 * @param {number} landed
 */
export function findShortfall(wanted, landed) {
  const shortfall = wanted - landed;
  return Math.abs(shortfall) < 1 ? shortfall : 0;
}

/* global readPulledBy -- from season-header.js */

/**
 * Keeps the rows of `view`, a tab the page scrolls, where they are on the screen as what's above
 * it grows or shrinks while it shows.
 * @param {HTMLElement} view
 */
export function keepPagePlace(view) {
  const readTop = () =>
    view.classList.contains("active")
      ? view.getBoundingClientRect().top + scrollY - readPulledBy(view)
      : null;
  view.dataset.keptPlace = "";
  let keptTop = readTop();
  const watcher = new ResizeObserver(() => {
    const top = readTop();
    if (keptTop === null || top === null || top === keptTop) {
      keptTop = top;
      return;
    }
    const wanted = findKeptTop(scrollY, top - keptTop);
    scrollTo({ top: wanted, behavior: "instant" });
    keptTop = top - findShortfall(wanted, scrollY);
  });
  watcher.observe(view);
  watcher.observe(document.body);
}
