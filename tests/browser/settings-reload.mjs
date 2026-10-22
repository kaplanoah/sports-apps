import { expect } from "@playwright/test";
import { matchPath } from "./harness.mjs";
import { holdRequests } from "./hold-requests.mjs";
import { SETTINGS, openSettings } from "./settings.mjs";

/**
 * What settings shows of the device's choices and the seasons it can pick.
 * @param {import("@playwright/test").Page} page
 */
const readSettings = (page) =>
  page.locator(SETTINGS).evaluate((settings) => {
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
 * they were before the page's code arrives, and once it runs, what the device keeps, still on the
 * past season the page showed.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   look: string,
 *   switchName: string,
 *   pastSeason: string,
 * }} options a look, a switch, and a season other than the ones a device starts on
 */
export async function checkSettingsOnReload({ page, look, switchName, pastSeason }) {
  await openSettings(page);
  const settings = page.locator(SETTINGS);
  await settings.getByRole("radio", { name: look, exact: true }).check();
  const toggle = settings.getByRole("switch", { name: switchName });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.locator("#seasonPicker").selectOption(pastSeason);
  await expect(page.locator("#seasonPicker option[selected]")).toHaveAttribute("value", pastSeason);
  await expect(page.locator("#seasonRow")).toBeVisible();
  await expect(page.locator("#notifySwitch")).toBeAttached();
  const shown = await readSettings(page);
  const release = await holdRequests(page, matchPath("/js/app.js"), { times: 1 });

  await page.reload({ waitUntil: "commit" });

  await expect(settings).toBeVisible();
  await expect.poll(() => readSettings(page)).toEqual(shown);

  // Another tab turns the switch back on while the page's code is still on its way, and the
  // Notifications switch shows what it didn't, so only that code can show what each should.
  await page.evaluate(() => {
    localStorage.removeItem("newsChoices");
    const notifySwitch = /** @type {HTMLElement} */ (document.getElementById("notifySwitch"));
    const isOn = notifySwitch.getAttribute("aria-checked") === "true";
    notifySwitch.setAttribute("aria-checked", String(!isOn));
  });
  const filling = waitForSettingsFill(page);
  release();
  await filling;
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const shownNotify = Object.fromEntries(shown.switches).notifySwitch;
  await expect(page.locator("#notifySwitch")).toHaveAttribute("aria-checked", shownNotify);
  const switchId = await toggle.getAttribute("id");
  await expect
    .poll(() => readSettings(page))
    .toEqual({
      ...shown,
      switches: shown.switches.map(([id, isOn]) => [id, id === switchId ? "true" : isOn]),
    });
}

/**
 * Waits for the page to fill settings as it loads, from what the store answered or as it was drawn,
 * since it watches the news right after.
 * @param {import("@playwright/test").Page} page
 */
export const waitForSettingsFill = (page) => page.waitForRequest(matchPath("/store/news/cards"));

/**
 * A reload with settings open while the store can't list the seasons it keeps lists the ones the
 * picker listed before, with the season the page shows, which `beforeReload` can move on, chosen.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   beforeReload?: () => Promise<void>,
 *   seasons: string[],
 *   shown: string,
 * }} options
 */
export async function checkSeasonsOnFailedList({ page, beforeReload, seasons, shown }) {
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

/**
 * While the store can't list the seasons it keeps, a new current season it moves on to joins the
 * picker, with the past season shown still chosen.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   pastSeason: string,
 *   newSeason: number,
 *   moveCurrentTo: (year: number) => Promise<void>,
 *   seasons: string[],
 * }} options
 */
export async function checkNewCurrentSeasonListed({
  page,
  pastSeason,
  newSeason,
  moveCurrentTo,
  seasons,
}) {
  await openSettings(page);
  const picker = page.locator("#seasonPicker");
  await picker.selectOption(pastSeason);
  await expect(page.locator("#seasonPicker option[selected]")).toHaveAttribute("value", pastSeason);
  await page.route(matchPath("/store/seasons"), (route) => route.abort());

  await moveCurrentTo(newSeason);

  await expect(picker.locator("option")).toHaveText(seasons);
  await expect(picker).toHaveValue(pastSeason);
}

/**
 * A season picked while its record is on its way stays picked through a redraw of the picker
 * meanwhile, as when the store moves on to a new season, and once the record arrives.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   pastSeason: string,
 *   newSeason: number,
 *   moveCurrentTo: (year: number) => Promise<void>,
 * }} options
 */
export async function checkPickKeptThroughRedraw({ page, pastSeason, newSeason, moveCurrentTo }) {
  await openSettings(page);
  const picker = page.locator("#seasonPicker");
  await expect(picker.locator("option")).not.toHaveCount(0);
  const release = await holdRequests(page, matchPath(`/store/seasons/${pastSeason}`), { times: 1 });
  await picker.selectOption(pastSeason);

  await moveCurrentTo(newSeason);
  await expect(picker.locator(`option[value="${newSeason}"]`)).toBeAttached();
  release();

  await expect(page.locator("#titleYear")).toHaveText(pastSeason);
  await expect(picker).toHaveValue(pastSeason);
  await expect(page.locator("#seasonPicker option[selected]")).toHaveAttribute("value", pastSeason);
}

/**
 * A past season picked whose record can't be read puts the picker back on the current season the
 * page still shows, says the server can't be reached, and picking it again reads it again.
 * @param {{ page: import("@playwright/test").Page, pastSeason: string, currentSeason: string }} options
 */
export async function checkFailedPickPutBack({ page, pastSeason, currentSeason }) {
  await openSettings(page);
  const picker = page.locator("#seasonPicker");
  await expect(picker.locator("option")).not.toHaveCount(0);
  const failRead = (/** @type {import("@playwright/test").Route} */ route) => route.abort();
  await page.route(matchPath(`/store/seasons/${pastSeason}`), failRead);

  await picker.selectOption(pastSeason);

  await expect(page.locator("#stamp")).toContainText("Can't reach");
  await expect(picker).toHaveValue(currentSeason);
  await expect(page.locator("#seasonPicker option[selected]")).toHaveAttribute(
    "value",
    currentSeason,
  );
  await expect(page.locator("#titleYear")).toBeHidden();

  await page.unroute(matchPath(`/store/seasons/${pastSeason}`), failRead);
  await picker.selectOption(pastSeason);
  await expect(page.locator("#titleYear")).toHaveText(pastSeason);
}
