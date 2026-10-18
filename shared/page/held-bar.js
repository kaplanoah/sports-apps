/**
 * Ends a bar held over a list in a line once the list has scrolled under it, as a season's strip
 * of days (day-strip.css), the search's field (game-search.css), and the pill over the standings
 * and bracket (pager.css) do.
 * @param {Element | null | undefined} bar
 * @param {Element | null | undefined} list
 */
export const markBarStuck = (bar, list) =>
  bar?.classList.toggle("stuck", (list?.scrollTop ?? 0) > 0);
