// Touch gestures on the page, as a phone's finger makes them, and the Home Screen a page can be
// opened from.

/**
 * Makes the page think it was opened from the Home Screen, as iOS says with navigator.standalone.
 * @param {import("@playwright/test").Page} page
 */
export const openFromHomeScreen = (page) =>
  page.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true }),
  );

/**
 * Starts a touch at `from` and moves it in steps by `by`, returning a way to lift the finger. The
 * moves come as fast as the browser takes them, a flick, unless `durationMs` spreads their times
 * out, as a slow drag that comes to rest before the finger lifts. With `isFrameByFrame`, each move
 * waits for the page's next frame, so the page draws where each one leaves what it moves.
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }} from
 * @param {{ x?: number, y?: number }} by
 * @param {{ durationMs?: number, isFrameByFrame?: boolean }} [options]
 * @returns {Promise<() => Promise<void>>}
 */
export async function drag(
  page,
  from,
  { x = 0, y = 0 },
  { durationMs, isFrameByFrame = false } = {},
) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const startSeconds = Date.now() / 1000;
  const steps = 10;
  /** @param {number} step */
  const readTimestamp = (step) =>
    durationMs === undefined
      ? {}
      : { timestamp: startSeconds + (durationMs / 1000) * (step / steps) };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
    ...readTimestamp(0),
  });
  for (let step = 1; step <= steps; step += 1) {
    if (isFrameByFrame)
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (x * step) / steps, y: from.y + (y * step) / steps }],
      ...readTimestamp(step),
    });
  }
  return async () => {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
      ...readTimestamp(steps + 1),
    });
    await session.detach();
  };
}

/**
 * Pulls the page down from near its top by `distance`, and lets go.
 * @param {import("@playwright/test").Page} page
 * @param {number} distance
 */
export async function pullDown(page, distance) {
  const release = await drag(page, { x: 200, y: 40 }, { y: distance });
  await release();
}
