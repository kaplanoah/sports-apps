/**
 * Items in a line of words, like "ERA, WHIP, and BB/9" or "Lindor and Alonso".
 * @param {string[]} items
 */
export function joinWithAnd(items) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
