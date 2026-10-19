import { isAsFarAs, isPast } from "./spring-scroll.js";

/**
 * Marks a bar held at the top once the list under it has scrolled as far as `heldAt`, how far the
 * list scrolls before the bar holds.
 * @param {Element} bar
 * @param {Element} list
 * @param {number} heldAt
 */
export const markBarHeld = (bar, list, heldAt) =>
  bar.classList.toggle("held", isAsFarAs(list.scrollTop, heldAt));

/**
 * Ends a bar held over a list in a line once the list has scrolled under it, past `heldAt`, how far
 * the list scrolls before the bar holds.
 * @param {Element | null | undefined} bar
 * @param {Element | null | undefined} list
 * @param {number} [heldAt]
 */
export const markBarStuck = (bar, list, heldAt = 0) =>
  bar?.classList.toggle("stuck", Boolean(list && isPast(list, heldAt)));
