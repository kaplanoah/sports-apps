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
 * Starts a touch at the first of `points` and moves it through the rest, returning a way to lift
 * the finger. The moves come as fast as the browser takes them, a flick, unless `durationMs`
 * spreads their times out, as a slow drag that comes to rest before the finger lifts. With
 * `isFrameByFrame`, each move waits for the page's next frame, so the page draws where each one
 * leaves what it moves, which spaces their times a frame apart too, so a test that checks each
 * frame sets the drag's speed with `durationMs`.
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }[]} points
 * @param {{ durationMs?: number, isFrameByFrame?: boolean }} [options]
 * @returns {Promise<() => Promise<void>>}
 */
export async function dragAlong(page, points, { durationMs, isFrameByFrame = false } = {}) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const startSeconds = Date.now() / 1000;
  const steps = points.length - 1;
  /** @param {number} step */
  const readTimestamp = (step) =>
    durationMs === undefined
      ? {}
      : { timestamp: startSeconds + (durationMs / 1000) * (step / steps) };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [points[0]],
    ...readTimestamp(0),
  });
  for (let step = 1; step <= steps; step += 1) {
    if (isFrameByFrame)
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [points[step]],
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

const DRAG_STEPS = 10;

/**
 * Starts a touch at `from` and moves it in even steps by `by`, as `dragAlong` does.
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }} from
 * @param {{ x?: number, y?: number }} by
 * @param {{ durationMs?: number, isFrameByFrame?: boolean }} [options]
 */
export const drag = (page, from, { x = 0, y = 0 }, options) =>
  dragAlong(
    page,
    Array.from({ length: DRAG_STEPS + 1 }, (_, step) => ({
      x: from.x + (x * step) / DRAG_STEPS,
      y: from.y + (y * step) / DRAG_STEPS,
    })),
    options,
  );

/** Where a pull down starts, on the header near the page's top. */
export const PULL_START = { x: 200, y: 40 };

/**
 * Pulls the page down from near its top by `distance`, and lets go.
 * @param {import("@playwright/test").Page} page
 * @param {number} distance
 */
export async function pullDown(page, distance) {
  const release = await drag(page, PULL_START, { y: distance });
  await release();
}
