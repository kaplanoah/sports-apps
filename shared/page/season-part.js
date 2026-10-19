/**
 * The season's standings or bracket that holds `element`, or null for an element in neither.
 * @param {Element} element
 */
export const findPartHolding = (element) =>
  /** @type {HTMLElement | null} */ (element.closest(".season-part"));
