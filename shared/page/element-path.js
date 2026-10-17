// Where an element sits under another, by child indexes, so a copy of the markup, or the same
// markup drawn again on a later load, can find it, as where a part was scrolled is put back.

/**
 * The child indexes that lead from `ancestor` down to `element`.
 * @param {Element} ancestor
 * @param {Element} element
 */
export function readPath(ancestor, element) {
  /** @type {number[]} */
  const path = [];
  for (let child = element; child !== ancestor && child.parentElement;) {
    path.unshift([...child.parentElement.children].indexOf(child));
    child = child.parentElement;
  }
  return path;
}

/**
 * The element `path` leads to under `ancestor`, if it's still there.
 * @param {Element} ancestor
 * @param {number[]} path
 * @returns {Element | undefined}
 */
export const followPath = (ancestor, path) =>
  path.reduce(
    (/** @type {Element | undefined} */ parent, index) => parent?.children[index],
    ancestor,
  );
