// How many compositing layers Chromium draws the page in, as its DevTools' Layers panel lists them,
// and each view's count against its budget.

import { expect } from "@playwright/test";
import { waitForTimedAnimations } from "./animations.mjs";

/**
 * Counts the layers in the page's next layer tree, once a frame has drawn it. A change to the page
 * that draws nothing new doesn't always bring a frame, so it changes the page again until one comes.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<number>}
 */
async function countLayers(page) {
  const session = await page.context().newCDPSession(page);
  /** @type {number | null} */
  let count = null;
  session.on("LayerTree.layerTreeDidChange", ({ layers }) => {
    if (layers && count === null) count = layers.length;
  });
  await session.send("LayerTree.enable");
  await expect
    .poll(async () => {
      await page.evaluate(() =>
        document.body.style.setProperty("--layer-count", String(Math.random())),
      );
      return count;
    })
    .not.toBeNull();
  await session.detach();
  return /** @type {number} */ (count);
}

/**
 * Shows each view in turn, once nothing in it is still loading or moving, as a tapped control's
 * press easing back draws in a layer of its own, and expects its layers within its budget, naming
 * every view over.
 * @param {import("@playwright/test").Page} page
 * @param {{ view: string, show: () => Promise<void> }[]} views
 * @param {Record<string, number>} budgets
 */
export async function expectWithinBudgets(page, views, budgets) {
  const counts = /** @type {Record<string, number>} */ ({});
  for (const { view, show } of views) {
    await show();
    await expect(page.locator(".placeholder:visible")).toHaveCount(0);
    await waitForTimedAnimations(page);
    counts[view] = await countLayers(page);
  }
  const over = Object.entries(counts)
    .filter(([view, count]) => !(count <= budgets[view]))
    .map(([view, count]) => `${view}: ${count} layers, over its budget of ${budgets[view]}`);
  expect(over).toEqual([]);
}
