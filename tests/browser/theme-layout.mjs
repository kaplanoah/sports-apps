// The parts a theme may lift a fraction of a pixel, where its colors look off center otherwise.
const PLACED_BY_EYE = ".nscore";

/**
 * Where every shown element sits, keyed by its path of child indexes from the body, rounded to the
 * half pixel. A theme changes only colors, so two themes' layouts of the same view are the same.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<Record<string, string>>}
 */
export const readLayout = (page) =>
  page.evaluate((placedByEye) => {
    /** @param {number} value */
    const round = (value) => Math.round(value * 2) / 2;
    /** @param {Element} element */
    const readPath = (element) => {
      const path = [];
      for (
        let node = element;
        node !== document.body;
        node = /** @type {Element} */ (node.parentElement)
      )
        path.unshift([.../** @type {Element} */ (node.parentElement).children].indexOf(node));
      return path.join(".");
    };
    /** @type {Record<string, string>} */
    const layout = {};
    for (const element of document.body.querySelectorAll("*")) {
      if (!element.checkVisibility() || element.matches(placedByEye)) continue;
      const box = element.getBoundingClientRect();
      const name = `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""} ${readPath(element)}`;
      layout[name] = [box.x, box.y, box.width, box.height].map(round).join(" ");
    }
    return layout;
  }, PLACED_BY_EYE);

/**
 * The elements whose place or size differs between two layouts, each with both.
 * @param {Record<string, string>} first
 * @param {Record<string, string>} second
 */
export const listLayoutChanges = (first, second) =>
  [...new Set([...Object.keys(first), ...Object.keys(second)])]
    .filter((name) => first[name] !== second[name])
    .map((name) => `${name}: ${first[name] ?? "hidden"} -> ${second[name] ?? "hidden"}`);
