import { expect } from "@playwright/test";
import { matchPath } from "./harness.mjs";
import { holdRequests } from "./hold-requests.mjs";

/**
 * What settings shows of the device's choices and the seasons it can pick.
 * @param {import("@playwright/test").Page} page
 */
const readSettings = (page) =>
  page.locator("#settingsDialog").evaluate((settings) => {
    const row = /** @type {HTMLElement} */ (settings.querySelector("#seasonRow"));
    const picker = /** @type {HTMLSelectElement | null} */ (row.querySelector("select"));
    const checked = /** @type {HTMLInputElement | null} */ (
      settings.querySelector("input[name=appearance]:checked")
    );
    return {
      isSeasonHidden: row.hidden,
      seasons: [...(picker?.options ?? [])].map((option) => option.textContent),
      season: picker?.value,
      switches: [...settings.querySelectorAll("[role=switch]")].map((each) => [
        each.id,
        each.getAttribute("aria-checked"),
      ]),
      appearance: checked?.value,
    };
  });

/**
 * A reload with settings open shows the seasons it can pick, its switches, and the look picked as
 * they were before the page's code arrives, and the same once it runs.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<void>,
 *   look: string,
 *   switchName: string,
 * }} options a look and a switch other than the ones a device starts on
 */
export async function checkSettingsOnReload({ page, openSettings, look, switchName }) {
  await openSettings(page);
  const settings = page.locator("#settingsDialog");
  await settings.getByRole("radio", { name: look, exact: true }).check();
  const toggle = settings.getByRole("switch", { name: switchName });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#seasonPicker option")).not.toHaveCount(0);
  await expect(page.locator("#seasonRow")).toBeVisible();
  await expect(page.locator("#notifySwitch")).toBeAttached();
  const shown = await readSettings(page);
  const release = await holdRequests(page, matchPath("/js/app.js"), { times: 1 });

  await page.reload({ waitUntil: "commit" });

  await expect(settings).toBeVisible();
  await expect.poll(() => readSettings(page)).toEqual(shown);

  const filling = waitForSettingsFill(page);
  release();
  await filling;
  await expect.poll(() => readSettings(page)).toEqual(shown);
}

/**
 * Waits for the page to fill settings as it loads, from what the store answered or as it was drawn,
 * since it watches the news right after.
 * @param {import("@playwright/test").Page} page
 */
const waitForSettingsFill = (page) => page.waitForRequest(matchPath("/store/news/cards"));

/**
 * A reload with settings open while the store can't list the seasons it keeps lists the ones the
 * picker listed before, with the season the page shows, which `beforeReload` can move on, chosen.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<void>,
 *   beforeReload?: () => Promise<void>,
 *   seasons: string[],
 *   shown: string,
 * }} options
 */
export async function checkSeasonsOnFailedList({
  page,
  openSettings,
  beforeReload,
  seasons,
  shown,
}) {
  await openSettings(page);
  const row = page.locator("#seasonRow");
  await expect(row.locator("option")).not.toHaveCount(0);
  await page.route(matchPath("/store/seasons"), (route) => route.abort());
  await beforeReload?.();
  const filling = waitForSettingsFill(page);

  await page.reload();

  await filling;
  await expect(row).toBeVisible();
  await expect(row.locator("option")).toHaveText(seasons);
  await expect(page.locator("#seasonPicker")).toHaveValue(shown);
}
