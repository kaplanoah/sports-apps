import {
  test,
  expect,
  EVENING_FIXTURE,
  ON_A_PHONE,
  keepUpdatesFromEarlierVisit,
  openApp,
  openSettings,
  readKept,
} from "./harness.mjs";
import { dismissUpdatesBox } from "../../../../tests/browser/updates-box.mjs";

const listShownRanking = (page) =>
  page
    .locator("#rankList .rank-item")
    .evaluateAll((items) => items.map((item) => /** @type {HTMLElement} */ (item).dataset.id));

const LOCKED_AT = new Date(Date.parse(EVENING_FIXTURE.now) - 60 * 60 * 1000).toISOString();
const SEASON_WITH_AN_UPDATE = { log: [{ kind: "lock", at: LOCKED_AT }] };

test("loading the page reads which season is current and its record once each, and again as it watches them, and the season's games, its list of players, and the news once as it watches them", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await expect.poll(() => app.countOpenSockets()).toBe(1);

  await expect
    .poll(() => app.listStoreReads().sort())
    .toEqual([
      "/store/live/current",
      "/store/live/current",
      "/store/live/status",
      "/store/news/cards",
      "/store/player-index/2026",
      "/store/schedules-2026?limit=12",
      "/store/seasons/2026",
      "/store/seasons/2026",
      "/store/seasons?limit=50",
    ]);
});

test("a store answer the page can't read says the page's server can't be reached", async ({
  page,
}) => {
  await openApp(page, { portalReadsDocuments: true });
  await expect(page.locator("#stamp")).toContainText("Can't reach the page's server right now");
});

test.describe("on a phone", () => {
  test.use(ON_A_PHONE);
  test.beforeEach(({ page }) => keepUpdatesFromEarlierVisit(page));

  test("each device keeps its own ranking and Updates dismissal, and the store keeps neither", async ({
    page,
  }) => {
    const storeWrites = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/store/"))
        storeWrites.push(request.url());
    });
    const app = await openApp(page, { store: { "seasons/2026": SEASON_WITH_AN_UPDATE } });
    await dismissUpdatesBox(page);
    await expect(page.locator("#updates")).toBeHidden();
    await openSettings(page);
    await expect(page.locator("#rankList .rank-item")).toHaveCount(12);
    const byName = await listShownRanking(page);
    await page.locator("#rankList .rank-item").first().locator(".grip").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", byName[0]);

    const record = await app.readDocument("seasons/2026");
    expect(record).not.toHaveProperty("ranking");
    expect(record).not.toHaveProperty("seenAt");
    expect(storeWrites).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#updates")).toContainText("The official bracket is set");
    await openSettings(page);
    await expect.poll(() => listShownRanking(page)).toEqual(byName);
    expect(await readKept(page, "rankings")).toBeNull();
  });

  test("a change the Worker saves shows up without a reload", async ({ page }) => {
    const app = await openApp(page);
    await app.updateFromWorker();
    await expect.poll(() => app.countOpenSockets()).toBeGreaterThan(0);

    await app.lockBracket();

    await expect(page.locator("#updates")).toContainText("The official bracket is set");
  });

  test("a page that loses its connection catches up when it reconnects", async ({ page }) => {
    const app = await openApp(page);
    await app.updateFromWorker();
    await expect.poll(() => app.countOpenSockets()).toBe(1);

    await app.dropConnections();
    await app.lockBracket();
    await page.clock.runFor(2000);
    await expect(page.locator("#updates")).toContainText("The official bracket is set");
    await expect.poll(() => app.countOpenSockets()).toBe(1);
  });
});
