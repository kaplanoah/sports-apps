import { expect } from "@playwright/test";

// The settings switch that turns Diagnostics on, which every app's settings has.

/** @param {import("@playwright/test").Page} page */
export const findDiagnosticsSwitch = (page) => page.getByRole("switch", { name: "Diagnostics" });

/**
 * Turns Diagnostics on from settings, and closes them.
 * @param {import("@playwright/test").Page} page
 */
export async function turnOnDiagnostics(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await findDiagnosticsSwitch(page).click();
  await expect(findDiagnosticsSwitch(page)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settingsDialog")).toBeHidden();
}
