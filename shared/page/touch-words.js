// How a touch moved and who took it, in the words of the Diagnostics logs that follow touches.

/** @typedef {{ x: number, y: number }} Move */

/**
 * A distance in whole pixels and its way, or nothing for one that rounds to none.
 * @param {number} distance
 * @param {[string, string]} ways the way a negative distance goes, then a positive one
 * @param {string} [unit] written after the number, as "px"
 */
export function describeDistance(distance, [back, on], unit = "") {
  const pixels = Math.round(distance);
  return pixels ? `${Math.abs(pixels)}${unit} ${pixels < 0 ? back : on}` : "";
}

/**
 * How far a finger moved each way it went, or nothing for a finger that didn't.
 * @param {Move} move
 */
const describeMove = (move) =>
  [describeDistance(move.x, ["left", "right"]), describeDistance(move.y, ["up", "down"])]
    .filter(Boolean)
    .join(" and ");

/**
 * @param {Move} moved
 * @param {boolean} isCancelled
 */
export function describeLift(moved, isCancelled) {
  const end = isCancelled ? "cancelled" : "lifted";
  const distance = describeMove(moved);
  return distance ? `${end} after moving ${distance}` : `${end} without moving`;
}

/** @param {Move} takenAt */
export function describeTaking(takenAt) {
  const distance = describeMove(takenAt);
  const when = distance ? `once it had moved ${distance}` : "before it moved";
  return `the page's code took the touch ${when}`;
}

/** @param {boolean} isPointerCancelled */
export const describePointer = (isPointerCancelled) =>
  isPointerCancelled ? "its pointer was cancelled" : "its pointer wasn't cancelled";

/**
 * @param {{ clientX: number, clientY: number }} point
 * @param {{ x: number, y: number }} origin
 * @returns {Move}
 */
export const measureMove = (point, origin) => ({
  x: point.clientX - origin.x,
  y: point.clientY - origin.y,
});
