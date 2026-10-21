// The season's standings and bracket are its parts, each of which scrolls on its own.

const SEASON_PART = ".season-part";

/**
 * Whether `element` is one of the season's standings or bracket, each of which scrolls on its own.
 * @param {EventTarget | null | undefined} element
 * @returns {element is HTMLElement}
 */
export const isSeasonPart = (element) =>
  element instanceof HTMLElement && element.matches(SEASON_PART);

/**
 * The season's standings or bracket that holds `element`, or null for an element in neither.
 * @param {Element} element
 */
export const findPartHolding = (element) =>
  /** @type {HTMLElement | null} */ (element.closest(SEASON_PART));
