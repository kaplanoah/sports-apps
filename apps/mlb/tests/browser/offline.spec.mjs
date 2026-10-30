import { checkOfflineSecurity, waitForCopy } from "../../../../tests/browser/offline-security.mjs";
import { takeAwayPush } from "../../../../tests/browser/devices.mjs";
import { test, expect, openApp } from "./harness.mjs";

test.use({ serviceWorkers: "allow", contextOptions: { reducedMotion: "reduce" } });

test("a page opened offline opens from its copy and shows what it last showed", async ({
  page,
}) => {
  // A browser without push keeps the copy all the same.
  await takeAwayPush(page);
  await openApp(page);
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await waitForCopy(page);
  await page.context().setOffline(true);

  await page.reload();

  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await expect(page.locator("#loadNote")).toHaveCount(0);
});

test("an old cached page upgrades to enforced CSP and keeps it offline", async ({ page }) => {
  await checkOfflineSecurity(page, openApp);
});
