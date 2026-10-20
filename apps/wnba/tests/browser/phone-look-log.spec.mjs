import { test, expect, openApp } from "./harness.mjs";
import { turnOnDiagnostics } from "../../../../tests/browser/diagnostics-switch.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

const RECORD_MS = 5000;

/** @param {import("@playwright/test").Page} page */
const findRecords = (page) => page.locator("#diagnostics");

test("with Diagnostics on, each change of the phone's look is logged, with what the page reads then and a task later, and among the steps of the open under way", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await page.reload();
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.clock.runFor(100);
  await page.emulateMedia({ colorScheme: "light" });
  await page.clock.runFor(RECORD_MS + 1000);
  await openSettings(page);

  const log = findRecords(page).locator(".diagnostics-record", { hasText: "Phone look" });
  await log.locator("summary").click();
  const changes = log.locator("li", { hasText: "the phone reports" });
  await expect(changes.first()).toContainText(
    /the phone reports light; reads light, then light \d+ms later; page shown/,
  );
  await expect(changes.nth(1)).toContainText(
    /the phone reports dark; reads dark, then dark \d+ms later; page shown/,
  );
  await expect(
    findRecords(page).locator(".diagnostics-record").first().locator("li", {
      hasText: "the phone reports dark",
    }),
  ).toHaveCount(1);
});
