import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { showTheme } from "../../../../tests/browser/theme-layout.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { comeBackTo, setHidden } from "../../../../tests/browser/visibility.mjs";
import { test, expect, openApp, openSettings, chooseSeason, SEASON_2025 } from "./harness.mjs";
import { openRanking, waitForSheetToRise, WITH_A_PAST_SEASON } from "./settings-sheet.mjs";
import { LAPTOP, PHONE } from "./screen-sizes.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// Settings shorter than 640px, as on a phone in a browser whose bars take some of the screen.
const SHORT_SCREEN = { width: 375, height: 600 };

/** @param {import("@playwright/test").Page} page */
async function expectWholeRankingInView(page) {
  const sheet = await page.locator("#rankingDialog").boundingBox();
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

test("a Settings caret opens Ranking, numbered 1 to 12, without another main tab", async ({
  page,
}) => {
  await openApp(page);
  const tabs = page.getByRole("tablist", { name: "Views" }).getByRole("tab");
  await expect(tabs).toHaveCount(4);
  for (const [index, name] of ["Standings", "Games", "News", "Search"].entries())
    await expect(tabs.nth(index)).toHaveAccessibleName(name);

  await openSettings(page);
  await openRanking(page);
  const ranking = page.getByRole("dialog", { name: "Ranking", exact: true });
  await expect(ranking.getByRole("heading", { name: "Ranking" })).toBeVisible();
  await expect(ranking.locator(".ranking-note")).toHaveText("Who you want to win the World Series");
  await expect(ranking.locator("#rankList .rank-item")).toHaveCount(12);
  await expect(ranking.locator("#rankNumbers li")).toHaveText(
    Array.from({ length: 12 }, (_, index) => String(index + 1)),
  );
  await expect(ranking.locator("#rankList .status-chip").first()).toHaveText("Alive");
});

test("on a phone, the Ranking page shows its header and the whole ranking", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page, WITH_A_PAST_SEASON);
  await openSettings(page);
  await openRanking(page);
  await waitForSheetToRise(page);
  const ranking = page.getByRole("dialog", { name: "Ranking", exact: true });
  await expect(ranking.getByRole("heading", { name: "Ranking" })).toBeInViewport();
  await expectWholeRankingInView(page);
  await expect(ranking.locator(".ranking-note")).toBeVisible();
  await expect(ranking.locator("#rankList .rank-ws").first()).toBeVisible();
});

test("on a short screen, the ranking's note gives way so each row keeps both lines", async ({
  page,
}) => {
  await page.setViewportSize(SHORT_SCREEN);
  await openApp(page);
  await openSettings(page);
  await openRanking(page);
  await waitForSheetToRise(page);

  await expectWholeRankingInView(page);
  await expect(page.locator(".ranking-note")).toBeHidden();
  await expect(page.locator("#rankList .rank-ws").first()).toBeVisible();
});

test("each rank number stays level with its row", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await openRanking(page);
  await waitForSheetToRise(page);

  const numbers = await readCenters(page.locator("#rankNumbers li"));
  const rows = await readCenters(page.locator("#rankList .rank-item"));

  expect(numbers).toHaveLength(12);
  numbers.forEach((center, index) => expect(Math.abs(center - rows[index])).toBeLessThan(1));
});

test("on a wide screen, Ranking has its own modal and all twelve rows fit", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await openSettings(page);
  await expect(page.locator(`${SETTINGS} #rankList`)).toHaveCount(0);
  await expect(page.locator("#rankingBtn svg")).toBeVisible();
  const settings = await page.locator(SETTINGS).boundingBox();
  expect(settings.width).toBeLessThanOrEqual(420);
  await openRanking(page);
  await expectWholeRankingInView(page);
  expect((await page.locator("#rankingDialog").boundingBox()).width).toBeLessThanOrEqual(420);
});

test("Back returns to Settings and focuses the Ranking caret", async ({ page }) => {
  await openApp(page, WITH_A_PAST_SEASON);
  await openSettings(page);
  await openRanking(page);
  await page.locator("#rankingDialog").getByRole("button", { name: "Back to Settings" }).click();
  await expect(page.locator("#rankingDialog")).toBeHidden();
  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(page.locator("#rankingBtn")).toBeFocused();
});

test("each ranked club shows its league at the start of its second line", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await openRanking(page);
  await waitForSheetToRise(page);

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
  await openRanking(page);
  await waitForSheetToRise(page);

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
  await openRanking(page);

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
  await openRanking(page);

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

test("Ranking and Settings restore on reload before the app module arrives", async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await openRanking(page);
  const ranking = page.locator("#rankingDialog");
  const names = await ranking.locator(".team-name").allTextContents();
  const release = await holdRequests(page, /\/js\/app\.js/);
  await page.reload({ waitUntil: "commit" });
  await expect(ranking).toBeVisible();
  await expect(ranking.locator(".team-name")).toHaveText(names);
  await expect(ranking.getByRole("button", { name: "Back to Settings" })).toBeVisible();
  await expect(ranking.locator(".settings-back svg")).toBeVisible();
  release();
  await page.waitForLoadState("domcontentloaded");
  await ranking.getByRole("button", { name: "Back to Settings" }).click();
  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(page.locator("#rankingBtn")).toBeFocused();
});

test("Ranking closes after two minutes away, like Settings", async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await openRanking(page);
  await setHidden(page, true);
  await page.clock.runFor(2 * 60_000);
  expect(await comeBackTo(page, "#rankingDialog")).toBe(false);
  await expect(page.locator("#rankingDialog")).toBeHidden();
});

for (const width of [390, 1280])
  for (const theme of /** @type {const} */ (["light", "dark"]))
    test(`Ranking fits ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openApp(page);
      await showTheme(page, theme);
      await openSettings(page);
      await openRanking(page);
      await expectWholeRankingInView(page);
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(
        await page
          .locator("#rankingDialog")
          .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
      ).toBe(true);
    });
