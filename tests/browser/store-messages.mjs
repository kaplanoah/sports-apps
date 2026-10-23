import { expect } from "@playwright/test";
import { RECORD_MS } from "../../shared/page/diagnostics.js";
import { findRecords } from "./diagnostics-records.mjs";
import { turnOnDiagnostics } from "./diagnostics-switch.mjs";
import { openSettings } from "./settings.mjs";

// Store socket messages recorded by Diagnostics without exposing their payloads.

/**
 * @param {import("@playwright/test").Page} page
 * @param {(page: import("@playwright/test").Page) => Promise<{ sendSocketMessage: (message: unknown) => void, countWatchersHeard: () => number }>} openApp
 */
export async function checkUnreadableStoreMessage(page, openApp) {
  const app = await openApp(page);
  await turnOnDiagnostics(page);
  const heard = app.countWatchersHeard();
  await page.reload();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await expect.poll(() => app.countWatchersHeard()).toBeGreaterThan(heard);
  app.sendSocketMessage({ connected: true, payload: "private frame payload" });
  await page.clock.runFor(RECORD_MS);
  await openSettings(page);
  await expect(findRecords(page)).toContainText("Store sent a message it couldn't read");
  await expect(findRecords(page)).not.toContainText("private frame payload");
}
