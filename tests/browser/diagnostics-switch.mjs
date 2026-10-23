import { expect } from "@playwright/test";
import { RECORD_MS } from "../../shared/page/diagnostics.js";
import { SETTINGS, openSettings } from "./settings.mjs";

// The settings switch that turns Diagnostics on, which every app's settings has.

/** @param {import("@playwright/test").Page} page */
export const findDiagnosticsSwitch = (page) => page.getByRole("switch", { name: "Diagnostics" });

/**
 * Turns Diagnostics on from settings, and closes them.
 * @param {import("@playwright/test").Page} page
 */
export async function turnOnDiagnostics(page) {
  await openSettings(page);
  await findDiagnosticsSwitch(page).click();
  await expect(findDiagnosticsSwitch(page)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(SETTINGS)).toBeHidden();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {(page: import("@playwright/test").Page) => Promise<{ sendSocketMessage: (message: unknown) => void, countWatchersHeard: () => number }>} openApp
 */
export async function checkUnreadableStoreMessage(page, openApp) {
  const app = await openApp(page);
  await turnOnDiagnostics(page);
  const heard = app.countWatchersHeard();
  await page.reload();
  await expect.poll(() => app.countWatchersHeard()).toBeGreaterThan(heard);
  await openSettings(page);
  app.sendSocketMessage({ connected: true, payload: "private frame payload" });
  await page.clock.runFor(RECORD_MS);
  const records = page.locator("#diagnostics");
  await expect(records).toContainText("Store sent a message it couldn't read");
  await expect(records).not.toContainText("private frame payload");
}
