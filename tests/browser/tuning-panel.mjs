// The tuning panel beta loads while a round is open: its Tune button, a slider's arrows and reset,
// option buttons, Copy, and its place over a sheet, in each of the app's themes, and a production
// page that never loads it.

import { expect } from "@playwright/test";
import { listLowContrastText } from "./contrast.mjs";
import { buildTuningServer, servePageFiles } from "./release-worker.mjs";
import { SETTINGS, openSettings } from "./settings.mjs";
import { showTheme } from "./theme-layout.mjs";
import { listTextOffRoles } from "./type-roles.mjs";

const CORNERS = "--radius-control";
const ALIGN = "--sample-align";
const SAMPLE_ROUND = {
  name: "Sample round",
  values: [
    { property: CORNERS, label: "Control corners", min: 0, max: 12, step: 0.5, unit: "px" },
    { property: ALIGN, label: "Sample align", options: ["start", "center"] },
  ],
};

/**
 * @typedef {{
 *   page: import("@playwright/test").Page,
 *   app: string,
 *   openApp: (page: import("@playwright/test").Page) => Promise<unknown>,
 * }} App
 */

/** @param {import("@playwright/test").Page} page */
const findPanel = (page) => page.getByRole("region", { name: "Tuning" });

/** @param {import("@playwright/test").Page} page */
const findToggle = (page) => page.getByRole("button", { name: "Tune", exact: true });

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} property
 */
const findRow = (page, property) => findPanel(page).locator(`[data-property="${property}"]`);

/**
 * The value the page itself sets on :root, apart from what its stylesheets do.
 * @param {import("@playwright/test").Page} page
 * @param {string} property
 */
const readSetOnRoot = (page, property) =>
  page.evaluate((name) => document.documentElement.style.getPropertyValue(name), property);

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} property
 */
const readOnRoot = (page, property) =>
  page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    property,
  );

/**
 * Keeps each text the page copies, since a test's browser may not hand a page the clipboard.
 * @param {import("@playwright/test").Page} page
 */
const keepCopies = (page) =>
  page.addInitScript(() => {
    const copies = /** @type {string[]} */ ([]);
    Object.assign(window, { copies });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (/** @type {string} */ text) => void copies.push(text) },
    });
  });

/**
 * Opens the app as beta serves it while the sample round is open, with the panel open.
 * @param {App} app
 */
async function openTuning({ page, app, openApp }) {
  await keepCopies(page);
  await servePageFiles(page, buildTuningServer(app, SAMPLE_ROUND, "beta"));
  await openApp(page);
  await findToggle(page).click();
  await expect(findPanel(page)).toBeVisible();
  await expect(findToggle(page)).toBeHidden();
}

/**
 * A slider's arrows step its value on :root, the slider sets any value on its grid, and its reset
 * takes the value off :root, back to where the app's stylesheet puts it, and turns itself off.
 * @param {App} app
 */
export async function checkSliderSetsRoot(app) {
  const { page } = app;
  await openTuning(app);
  const start = await readOnRoot(page, CORNERS);
  const row = findRow(page, CORNERS);
  const reset = row.getByRole("button", { name: "Reset Control corners" });
  await expect(row.locator("output")).toHaveText(start);
  await expect(reset).toBeDisabled();

  await row.getByRole("button", { name: "Control corners a step up" }).click();
  const stepped = `${parseFloat(start) + 0.5}px`;
  await expect(row.locator("output")).toHaveText(stepped);
  expect(await readSetOnRoot(page, CORNERS)).toBe(stepped);
  await expect(reset).toBeEnabled();

  await row.getByRole("slider", { name: "Control corners" }).fill("8.5");
  await expect(row.locator("output")).toHaveText("8.5px");
  expect(await readOnRoot(page, CORNERS)).toBe("8.5px");
  await row.getByRole("button", { name: "Control corners a step down" }).click();
  await expect(row.locator("output")).toHaveText("8px");
  await expect(row.getByRole("slider")).toHaveValue("8");

  await reset.click();
  await expect(row.locator("output")).toHaveText(start);
  await expect(row.getByRole("slider")).toHaveValue(String(parseFloat(start)));
  expect(await readSetOnRoot(page, CORNERS)).toBe("");
  await expect(reset).toBeDisabled();
}

/**
 * An option button sets its value on :root and shows as pressed, and Copy hands over the round's
 * name and every value as text to paste back.
 * @param {App} app
 */
export async function checkOptionsAndCopy(app) {
  const { page } = app;
  await openTuning(app);
  const row = findRow(page, ALIGN);
  await expect(row.locator("output")).toHaveText("not set");
  await row.getByRole("button", { name: "center" }).click();
  await expect(row.getByRole("button", { name: "center" })).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByRole("button", { name: "start" })).toHaveAttribute("aria-pressed", "false");
  expect(await readSetOnRoot(page, ALIGN)).toBe("center");

  const corners = await readOnRoot(page, CORNERS);
  await findPanel(page).getByRole("button", { name: "Copy" }).click();
  await expect(findPanel(page).getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => /** @type {any} */ (window).copies)).toEqual([
    `Sample round\n${CORNERS}: ${corners}\n${ALIGN}: center`,
  ]);
}

/**
 * The panel keeps what was set, and whether it was open, through a reload, and its close leaves
 * the Tune button that opens it again.
 * @param {App} app
 */
export async function checkKeptOnReload(app) {
  const { page } = app;
  await openTuning(app);
  const row = findRow(page, CORNERS);
  await row.getByRole("slider", { name: "Control corners" }).fill("10");
  await page.reload();
  await expect(findRow(page, CORNERS).locator("output")).toHaveText("10px");
  expect(await readSetOnRoot(page, CORNERS)).toBe("10px");

  await findPanel(page).getByRole("button", { name: "Close tuning" }).click();
  await expect(findPanel(page)).toBeHidden();
  await findToggle(page).click();
  await expect(findPanel(page)).toBeVisible();
}

/**
 * A sheet leaves the page under it untouchable, so the panel moves into the sheet on top and still
 * takes taps there, and back out once it closes.
 * @param {App} app
 */
export async function checkPanelOverSheets(app) {
  const { page } = app;
  await openTuning(app);
  await openSettings(page);
  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(page.locator(`${SETTINGS} .tuning-panel`)).toHaveCount(1);
  await findRow(page, ALIGN).getByRole("button", { name: "start" }).click();
  expect(await readSetOnRoot(page, ALIGN)).toBe("start");

  await page.keyboard.press("Escape");
  await expect(page.locator(SETTINGS)).toBeHidden();
  await expect(page.locator("body > .tuning-panel")).toHaveCount(1);
}

/**
 * The panel's text keeps its type roles and reads clearly in both of the app's themes.
 * @param {App} app
 */
export async function checkPanelInThemes(app) {
  const { page } = app;
  await openTuning(app);
  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await showTheme(page, theme);
    expect(await listTextOffRoles(page), theme).toEqual([]);
    expect(await listLowContrastText(page), theme).toEqual([]);
  }
}

/**
 * A production page, with a round open, shows no Tune button and never asks for the panel.
 * @param {App} app
 */
export async function checkNoPanelInProduction({ page, app, openApp }) {
  const asked = /** @type {string[]} */ ([]);
  page.on("request", (request) => {
    if (request.url().includes("tuning")) asked.push(request.url());
  });
  await servePageFiles(page, buildTuningServer(app, SAMPLE_ROUND, null));
  await openApp(page);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(findToggle(page)).toHaveCount(0);
  await expect(page.locator(".tuning-panel")).toHaveCount(0);
  expect(asked).toEqual([]);
}
