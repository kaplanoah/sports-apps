// How many touchmove listeners that may stop a scroll lie on what's under a point, anything around
// it, the document, or the window. Any one makes the browser wait on the page before every scroll
// that starts there.

/**
 * @param {number} x
 * @param {number} y
 * @param {number} depth how many steps out from what's under the point
 */
const findAround = (x, y, depth) =>
  `(() => { let node = document.elementFromPoint(${x}, ${y}); for (let step = 0; step < ${depth} && node; step++) node = node.parentNode; return node ?? window; })()`;

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }} point
 */
export async function countScrollHoldersAt(page, { x, y }) {
  const session = await page.context().newCDPSession(page);
  let count = 0;
  for (let depth = 0, isWindow = false; !isWindow; depth++) {
    const { result } = await session.send("Runtime.evaluate", {
      expression: findAround(x, y, depth),
    });
    isWindow = result.className === "Window";
    const { listeners } = await session.send("DOMDebugger.getEventListeners", {
      objectId: /** @type {string} */ (result.objectId),
    });
    count += listeners.filter(
      (listener) => listener.type === "touchmove" && !listener.passive,
    ).length;
  }
  await session.detach();
  return count;
}
