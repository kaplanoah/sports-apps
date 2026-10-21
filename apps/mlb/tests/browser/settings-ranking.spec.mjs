import { test, expect, openApp, openSettings, chooseSeason, SEASON_2025 } from "./harness.mjs";
import { scrollSettingsToEnd, waitForSheetToRise, WITH_A_PAST_SEASON } from "./settings-sheet.mjs";
import { LAPTOP, PHONE } from "./screen-sizes.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// Settings shorter than 640px, as on a phone in a browser whose bars take some of the screen.
const SHORT_SCREEN = { width: 375, height: 600 };

/** @param {import("@playwright/test").Page} page */
async function expectWholeRankingInView(page) {
  const sheet = await page.locator(SETTINGS).boundingBox();
  const first = await page.locator("#rankList .rank-item").first().boundingBox();
  const last = await page.locator("#rankList .rank-item").last().boundingBox();
  expect(first.y).toBeGreaterThanOrEqual(sheet.y - 1);
  expect(last.y + last.height).toBeLessThanOrEqual(sheet.y + sheet.height + 1);
}

/** @param {import("@playwright/test").Locator} locator */
const readCenters = (locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return box.top + box.height / 2;
    }),
  );

test("the ranking has no tab of its own; settings hold it, numbered 1 to 12", async ({ page }) => {
  await openApp(page);
  const tabs = page.getByRole("tablist", { name: "Views" }).getByRole("tab");
  await expect(tabs).toHaveCount(3);
  for (const [index, name] of ["Standings", "Games", "News"].entries())
    await expect(tabs.nth(index)).toHaveAccessibleName(name);

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Ranking" })).toBeVisible();
  await expect(settings.locator(".ranking-note")).toHaveText(
    "Who you want to win the World Series",
  );
  await expect(settings.locator("#rankList .rank-item")).toHaveCount(12);
  await expect(settings.locator("#rankNumbers li")).toHaveText(
    Array.from({ length: 12 }, (_, index) => String(index + 1)),
  );
  await expect(settings.locator("#rankList .status-chip").first()).toHaveText("Alive");
});

test("on a phone, scrolling settings down shows the whole ranking, and the header scrolls away", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page, WITH_A_PAST_SEASON);
  await openSettings(page);
  await waitForSheetToRise(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("combobox", { name: "Season" })).toBeInViewport();

  await scrollSettingsToEnd(page);

  await expectWholeRankingInView(page);
  await expect(settings.getByRole("heading", { name: "Settings" })).not.toBeInViewport();
  await expect(settings.locator(".ranking-note")).toBeVisible();
  await expect(settings.locator("#rankList .rank-ws").first()).toBeVisible();
});

test("on a short screen, the ranking's note gives way so each row keeps both lines", async ({
  page,
}) => {
  await page.setViewportSize(SHORT_SCREEN);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);

  await scrollSettingsToEnd(page);

  await expectWholeRankingInView(page);
  await expect(page.locator(".ranking-note")).toBeHidden();
  await expect(page.locator("#rankList .rank-ws").first()).toBeVisible();
});

test("each rank number stays level with its row", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  await scrollSettingsToEnd(page);

  const numbers = await readCenters(page.locator("#rankNumbers li"));
  const rows = await readCenters(page.locator("#rankList .rank-item"));

  expect(numbers).toHaveLength(12);
  numbers.forEach((center, index) => expect(Math.abs(center - rows[index])).toBeLessThan(1));
});

test("on a wide screen, the settings and the whole ranking show side by side without scrolling", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await openSettings(page);

  const dialog = page.locator(SETTINGS);
  expect(
    await dialog.evaluate(
      (element) =>
        /** @type {HTMLElement} */ (element.querySelector(".settings-body")).offsetHeight <=
        element.clientHeight,
    ),
  ).toBe(true);
  await expectWholeRankingInView(page);
  const controls = await page.locator(".settings-main > .settings-controls").boundingBox();
  const list = await page.locator("#rankList").boundingBox();
  expect(controls.x + controls.width).toBeLessThan(list.x);
});

test("on a wide screen, the settings start right under the header, level with the ranking's heading", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page, WITH_A_PAST_SEASON);
  await openSettings(page);

  const header = await page.locator(`${SETTINGS} .sheet-top`).boundingBox();
  const controls = await page.locator(".settings-main > .settings-controls").boundingBox();
  const [season] = await readCenters(page.locator(".control-row > span").first());
  const [ranking] = await readCenters(page.locator("#rankingTitle"));
  expect(Math.abs(controls.y - (header.y + header.height))).toBeLessThan(1);
  expect(Math.abs(season - ranking)).toBeLessThan(2);
});

test("each ranked club shows its league at the start of its second line", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  await scrollSettingsToEnd(page);

  const rows = page.locator("#rankList .rank-item");
  const leagues = await rows.evaluateAll((items) =>
    items.map((item) => item.querySelector(".league-tag").textContent),
  );
  expect(leagues).toHaveLength(12);
  expect(new Set(leagues)).toEqual(new Set(["AL", "NL"]));

  const first = rows.first();
  const dot = await first.locator(".dot").boundingBox();
  const league = await first.locator(".league-tag").boundingBox();
  const history = await first.locator(".rank-ws").boundingBox();
  expect(league.y).toBeGreaterThan(dot.y + dot.height);
  expect(Math.abs(league.x - dot.x)).toBeLessThan(1);
  expect(history.x).toBeGreaterThan(league.x + league.width);
});

test("the AL and NL chips are one width, so the lines after them start level", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  await scrollSettingsToEnd(page);

  const widths = await page
    .locator("#rankList .league-tag")
    .evaluateAll((tags) => tags.map((tag) => [tag.textContent, tag.getBoundingClientRect().width]));
  expect(new Set(widths.map(([league]) => league))).toEqual(new Set(["AL", "NL"]));
  expect(new Set(widths.map(([, width]) => width))).toEqual(new Set([27.5]));
});

test("a row too short for two lines keeps its league beside the club", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openApp(page);
  await openSettings(page);
  await scrollSettingsToEnd(page);

  const first = page.locator("#rankList .rank-item").first();
  await expect(first.locator(".rank-ws")).toBeHidden();
  await expect(first.locator(".rank-drought")).toBeVisible();
  const [name] = await readCenters(first.locator(".team-name"));
  const [league] = await readCenters(first.locator(".league-tag"));
  expect(Math.abs(name - league)).toBeLessThan(2);
});

test("a club that's out looks like the rest, and its chip just says Out", async ({ page }) => {
  await openApp(page, { store: { "seasons/2025": SEASON_2025 } });
  await chooseSeason(page, "2025");
  await openSettings(page);

  const chips = await page.locator("#rankList .status-chip").allTextContents();
  expect(chips).toHaveLength(12);
  expect(chips.filter((chip) => chip === "Champs")).toHaveLength(1);
  expect(chips.filter((chip) => chip === "Out")).toHaveLength(11);
  const nameColors = await page
    .locator("#rankList .team-name")
    .evaluateAll((names) => names.map((name) => getComputedStyle(name).color));
  expect(new Set(nameColors).size).toBe(1);
  expect(await listLowContrastText(page)).toEqual([]);
});
