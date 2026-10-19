import { expect } from "@playwright/test";

/**
 * Does `action`, which scrolls `scroller` with a wheel or a finger, and waits for that scroll to
 * end, flick and all, as its `scrollend` event says.
 * @param {import("@playwright/test").Locator} scroller
 * @param {() => Promise<unknown>} action
 */
export async function waitForScrollEnd(scroller, action) {
  await scroller.evaluate((element) =>
    element.addEventListener("scrollend", () => element.setAttribute("data-scroll-ended", ""), {
      once: true,
    }),
  );
  await action();
  await expect(scroller).toHaveAttribute("data-scroll-ended");
  await scroller.evaluate((element) => element.removeAttribute("data-scroll-ended"));
}
