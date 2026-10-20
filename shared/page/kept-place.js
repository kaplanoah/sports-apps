// When what's above a list that scrolls grows or shrinks, like the Updates box opening, the list's
// scroll moves by as much, so the rows on the screen stay where they are, as Chrome's scroll
// anchoring does and Safari's doesn't, frame by frame as it eases. A list at its top stays there,
// so what opens above it shows. Each list the page keeps in place opts out of the browser's own
// anchoring (chrome.css and pager.css), so it moves once, the same in every browser.

/**
 * Where a list scrolled to `top` goes when what's above it moves its rows down by `change`, or up
 * by a negative one.
 * @param {number} top
 * @param {number} change
 */
export const findKeptTop = (top, change) => (top < 1 ? top : Math.max(0, top + change));

/**
 * Keeps the rows of `view`, a tab the page scrolls, where they are on the screen as what's above
 * it grows or shrinks while it shows.
 * @param {HTMLElement} view
 */
export function keepPagePlace(view) {
  const readTop = () =>
    view.classList.contains("active") ? view.getBoundingClientRect().top + scrollY : null;
  let keptTop = readTop();
  const watcher = new ResizeObserver(() => {
    const top = readTop();
    if (keptTop !== null && top !== null && top !== keptTop)
      scrollTo({ top: findKeptTop(scrollY, top - keptTop), behavior: "instant" });
    keptTop = top;
  });
  watcher.observe(view);
  watcher.observe(document.body);
}
