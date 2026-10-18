import { isPast } from "./spring-scroll.js";

/**
 * Ends a bar held over a list in a line once the list has scrolled under it, past `heldAt`, how far
 * the list scrolls before the bar holds.
 * @param {Element | null | undefined} bar
 * @param {Element | null | undefined} list
 * @param {number} [heldAt]
 */
export const markBarStuck = (bar, list, heldAt = 0) =>
  bar?.classList.toggle("stuck", Boolean(list && isPast(list, heldAt)));
