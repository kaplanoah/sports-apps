import { test, expect, openApp } from "./harness.mjs";
import { setHidden } from "../../../../tests/browser/visibility.mjs";
import { turnOnDiagnostics } from "../../../../tests/browser/diagnostics-switch.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";
import { findRecords } from "../../../../tests/browser/diagnostics-records.mjs";
import { reloadAndRecord } from "./diagnostics-records.mjs";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

/** @param {import("@playwright/test").Page} page */
const findViewportLog = (page) =>
  findRecords(page).locator(".diagnostics-record", { hasText: "Viewport" });

/**
 * The page reads the viewport on the frame after its resize event, and a slow machine can send that
 * event only after the test has opened a sheet, so the clock moves on once the page has it.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function resizeViewport(page, size) {
  const resize = await page.evaluateHandle(() => ({
    seen: new Promise((resolve) =>
      visualViewport?.addEventListener("resize", () => resolve(true), { once: true }),
    ),
  }));
  await page.setViewportSize(size);
  await resize.evaluate((pending) => pending.seen);
  await page.clock.runFor(100);
}

test("with Diagnostics on, the viewport is logged as the page opens, and again when it changes", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);

  await resizeViewport(page, { width: 390, height: 700 });
  await openSettings(page);

  const lines = findViewportLog(page).locator("li");
  await expect(findViewportLog(page).locator("summary")).toContainText("Steady");
  await expect(lines.first()).toContainText(/layout 700, .*sheet ends 700/);
  const resized = lines.filter({ hasText: "layout 700", hasNotText: "sheet ends" });
  await expect(resized).toContainText(/tab bar ends \d+/);
  await expect(lines.filter({ hasText: "layout 844, visual 844 from 0" })).not.toHaveCount(0);
});

for (const [moved, moveViewport] of [
  ["as the page scrolls", () => scrollTo(0, 1)],
  ["as the visual viewport moves", () => visualViewport?.dispatchEvent(new Event("scroll"))],
]) {
  test(`a visual viewport out of line with the layout one is flagged as off ${moved}`, async ({
    page,
  }) => {
    await openApp(page);
    await turnOnDiagnostics(page);
    await reloadAndRecord(page);

    await page.evaluate(() =>
      Object.defineProperty(visualViewport, "offsetTop", { configurable: true, get: () => 110 }),
    );
    await page.evaluate(moveViewport);
    await page.clock.runFor(100);
    await openSettings(page);

    const log = findViewportLog(page);
    await expect(log.locator("summary")).toContainText("Off");
    const offBeforeSettings = log.locator(".diagnostics-dip", { hasNotText: "sheet ends" });
    await expect(offBeforeSettings).toContainText("visual 844 from 110");
  });
}

test("with Diagnostics on, the viewport is logged each time the page leaves the screen and comes back, though nothing changed", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);

  await setHidden(page, true);
  await setHidden(page, false);
  await page.clock.runFor(100);
  await openSettings(page);

  const lines = findViewportLog(page).locator("li");
  await expect(lines.first()).toContainText(/sheet ends \d+/);
  await expect(lines.nth(1)).toContainText(/Back: screen \d+, layout 844, /);
  await expect(lines.nth(2)).toContainText(/Left: screen \d+, layout 844, /);
  await expect(lines.nth(3)).toContainText(/Opened: screen \d+, layout 844, /);
});

test("with Diagnostics on, a bounce past the page's top isn't logged", async ({ page }) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);

  await page.evaluate(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => -40 });
    Object.defineProperty(visualViewport, "offsetTop", { configurable: true, get: () => -40 });
    visualViewport?.dispatchEvent(new Event("scroll"));
  });
  await page.clock.runFor(100);
  await page.evaluate(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => 0 });
    Object.defineProperty(visualViewport, "offsetTop", { configurable: true, get: () => 0 });
  });
  await openSettings(page);

  const log = findViewportLog(page);
  await expect(log.locator("li").filter({ hasText: "sheet ends" })).toHaveCount(1);
  await expect(log.locator("li", { hasText: "from -40" })).toHaveCount(0);
});
