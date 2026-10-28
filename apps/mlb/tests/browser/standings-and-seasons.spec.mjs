import { checkSelectArrow } from "../../../../tests/browser/settings.mjs";
import {
  test,
  expect,
  openApp,
  openBracket,
  openSettings,
  buildFixtureSnapshot,
  chooseSeason,
  EVENING_FIXTURE,
  readColor,
  readKept,
  SEASON_2025,
  buildSeasonRecord,
} from "./harness.mjs";
import { listAnimations } from "../../../../tests/browser/animations.mjs";
import { measureFieldFace } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { listLowContrastTextAsShown } from "../../../../tests/browser/contrast.mjs";
import { pressOn } from "../../../../tests/browser/press-looks.mjs";
import { LAPTOP } from "./screen-sizes.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PLAYOFF_FIELD_2026 = [
  "Rays",
  "Guardians",
  "Rangers",
  "Yankees",
  "Red Sox",
  "White Sox",
  "Brewers",
  "Dodgers",
  "Braves",
  "Padres",
  "Cubs",
  "Phillies",
];

test("renders the bracket, standings and stamp from the season's record the Worker saved", async ({
  page,
}) => {
  await openApp(page);

  const bracket = page.locator("#bracketWrap");
  for (const club of PLAYOFF_FIELD_2026) await expect(bracket).toContainText(club);
  const stampLines = page.locator("#stamp > span");
  await expect(stampLines.first()).toHaveText(/^NOW\s*Reds @ Braves 5-5 in the 5th/);
  await expect(stampLines.nth(1)).toHaveText(/^Next first pitch /);

  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standingsWrap .div-block")).toHaveCount(8);
  await expect(page.locator("#standingsWrap")).toContainText("AL East");
});

test("standings open on each league's playoff field, and every table lines up", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");

  const fields = page.locator("#standingsWrap .field-grid .div-block");
  await expect(fields).toHaveCount(2);
  await expect(fields.first()).toContainText("AL Playoff Field");
  await expect(fields.first().locator(".wild-card-head")).toHaveText(/Wild cards/);

  const readHeights = (selector) =>
    page
      .locator(selector)
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  const tableHeights = await readHeights("#standingsWrap .div-grid table.st");
  expect(tableHeights).toHaveLength(6);
  expect(new Set(tableHeights).size).toBe(1);
  expect(new Set(await readHeights("#standingsWrap .div-title")).size).toBe(1);
});

test("every club's rank slot in the standings is as tall as a rank tag, so a ranked club's row is as tall as an unranked one's", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standingsWrap table.st .rank-tag").first()).toBeVisible();
  const readHeights = (selector) =>
    page
      .locator(selector)
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  const tagHeights = new Set(await readHeights("#standingsWrap table.st .rank-tag"));
  const emptySlots = "#standingsWrap table.st .rank-slot:empty";
  await expect(page.locator(emptySlots).first()).toBeAttached();
  expect(tagHeights.size).toBe(1);
  expect(new Set(await readHeights(emptySlots))).toEqual(tagHeights);
});

test("on a wide screen, every column of the standings shows inside its table", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const tables = page.locator("#standingsWrap table.st");
  await expect(tables).toHaveCount(8);

  const cellsPastTheirTable = await tables.evaluateAll((all) =>
    all.flatMap((table) => {
      const right = table.closest(".st-scroll").getBoundingClientRect().right;
      return [...table.querySelectorAll("th, td")]
        .filter((cell) => cell.getBoundingClientRect().right > right + 0.5)
        .map((cell) => cell.textContent.trim());
    }),
  );
  expect(cellsPastTheirTable).toEqual([]);
});

test("the standings show each club's game under way, and a delay in gold", async ({ page }) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const delayedGame = snapshot.slate.today.games.find((game) => game.home === "BOS");
  delayedGame.delay = "Delayed: Rain";
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  await openSeasonPart(page, "Standings");
  const cells = page.locator("#standingsWrap td.next-cell");

  const leading = cells.filter({ hasText: /^Up 3 @ NYY in the 6th$/ });
  await expect(leading).not.toHaveCount(0);
  await expect(leading.first()).toHaveCSS("color", await readColor(page, "--now"));
  await expect(cells.filter({ hasText: /^Down 3 vs TB in the 6th$/ })).not.toHaveCount(0);
  const delayed = cells.filter({ hasText: /^Down 1 vs CLE \u2014 Delayed: Rain$/ });
  await expect(delayed).not.toHaveCount(0);
  await expect(delayed.first()).toHaveCSS("color", await readColor(page, "--highlight"));
});

test("the leagues' standings sit side by side only when a game under way fits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const fields = page.locator("#standingsWrap .field-grid .div-block");
  const readTops = () =>
    fields.evaluateAll((blocks) => blocks.map((block) => block.getBoundingClientRect().top));

  await expect.poll(async () => new Set(await readTops()).size).toBe(1);
  const liveCells = page.locator("#standingsWrap td.next-cell.live");
  await expect(liveCells).not.toHaveCount(0);
  const clippedCount = await liveCells.evaluateAll(
    (cells) => cells.filter((cell) => cell.scrollWidth > cell.clientWidth).length,
  );
  expect(clippedCount).toBe(0);

  await page.setViewportSize({ width: 1399, height: 900 });
  await expect.poll(async () => new Set(await readTops()).size).toBe(2);
});

test("says when live scores can't be reached, and shows them once the Worker has them", async ({
  page,
}) => {
  const app = await openApp(page, {
    liveAvailable: false,
    store: { "live/status": { error: "upstream_error", detail: "MLB answered 503", write: "" } },
  });

  await expect(page.locator("#stamp")).toContainText(
    "Couldn't reach live scores. Trying again shortly.",
  );

  await app.updateFromWorker();
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);
  await expect(page.locator("#stamp")).not.toContainText("Couldn't reach live scores");
});

test("while the Worker can't reach MLB, the page says so over the last scores it saved", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);

  await app.writeFromWorker("live/status", {
    error: "upstream_error",
    detail: "MLB Stats API answered 503 for /api/v1/schedule",
    write: "",
    at: "2026-09-25T00:45:00.000Z",
  });

  await expect(page.locator("#stamp")).toContainText(
    "Couldn't reach live scores. Trying again shortly.",
  );
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);
});

test("switching to 2025 shows the finished bracket and its champion from its record", async ({
  page,
}) => {
  const app = await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await expect.poll(() => app.countSeasonReads()).toBe(2);

  await chooseSeason(page, "2025");

  const worldSeries = page.locator('#bracketWrap .box[data-round="WS"]');
  await expect(worldSeries.locator(".matchup-row.winner")).toContainText("Dodgers");
  await expect(worldSeries.locator(".card-note")).toHaveCount(0);
  const championships = page.locator('#bracketWrap .box[data-round="CS"]');
  await expect(championships).toHaveCount(2);
  await expect(championships.locator(".card-note")).toHaveCount(0);
  await expect(page.locator("#updates")).toBeHidden();
});

test("warns under the title when MLB stops sending a field", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);

  app.changeSnapshots((snapshot) => ({ ...snapshot, missing: ["wildCardRank"] }));
  await app.updateFromWorker();

  await expect(page.locator("#stamp")).toContainText(
    "MLB stopped sending wildCardRank, so some details may be blank",
  );
  expect(await listStrayPeriods(page)).toEqual([]);
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
});

test("a warning MLB's feed brings eases the header to its new height", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const readAnimations = await listAnimations(page);
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);

  app.changeSnapshots((snapshot) => ({ ...snapshot, missing: ["wildCardRank"] }));
  await app.updateFromWorker();

  await expect(page.locator("#stamp")).toContainText("MLB stopped sending wildCardRank");
  const growth = (await readAnimations()).find(({ classes }) => classes.includes("stamp"));
  expect(parseFloat(String(growth.last.height))).toBeGreaterThan(
    parseFloat(String(growth.first.height)),
  );
});

test("with no field yet, the bracket says it fills in once MLB projects one", async ({ page }) => {
  await openBracket(page, { liveAvailable: false });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  expect(await listStrayPeriods(page)).toEqual([]);
  const note = page.locator("#noFieldNote");
  await expect(note).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(note).toHaveCSS("border-top-style", "none");
  await expect(note.locator("p")).toHaveCSS("text-wrap-style", "balance");
  await expect(page.getByRole("button", { name: "Set the field" })).toHaveCount(0);
  await openSettings(page);
  await expect(page.locator("#rankList")).toHaveText(
    "The ranking fills in once there's a playoff field",
  );
});

test("the bracket and standings scroll from the keyboard, even in Safari", async ({ page }) => {
  await openBracket(page);
  await expect(page.getByRole("region", { name: "Bracket" })).toHaveAttribute("tabindex", "0");

  await openSeasonPart(page, "Standings");
  await expect(page.getByRole("region", { name: "AL East standings" })).toHaveAttribute(
    "tabindex",
    "0",
  );
});

test("the ranking can be reordered from the keyboard, and this device keeps it", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);
  await openSettings(page);
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);

  const firstItem = page.locator("#rankList .rank-item").first();
  const movedClubId = await firstItem.getAttribute("data-id");
  await firstItem.locator(".grip").focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
  await expect(page.locator("#rankList .rank-item").nth(1).locator(".grip")).toBeFocused();
  expect(((await readKept(page, "rankings")) ?? {})[2026]?.[1]).toBe(movedClubId);

  await page.reload();
  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
});

test("a ranking reordered in another tab shows in this one", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);
  await openSettings(page);
  const items = page.locator("#rankList .rank-item");
  await expect(items).toHaveCount(12);
  const order = await items.evaluateAll((shown) => shown.map((item) => item.dataset.id));

  await keepInOtherTab(page, "rankings", { 2026: [...order].reverse() });

  await expect(items.first()).toHaveAttribute("data-id", order.at(-1));
});

test("a stored field short a league says there's no field instead of breaking the page", async ({
  page,
}) => {
  const clubs = ["NYY", "TOR", "SEA", "BOS", "DET", "CLE", "HOU", "LAD", "MIL", "PHI", "CHC", "SD"];
  const teams = Object.fromEntries(
    clubs.map((id, index) => [id, { league: index < 7 ? "AL" : "NL", seed: (index % 6) + 1 }]),
  );
  await openBracket(page, {
    liveAvailable: false,
    store: { "seasons/2026": { year: 2026, teams, series: {}, log: [] } },
  });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  await openSettings(page);
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);
});

const buildEmptySeasonSnapshot = (season, springStart) => ({
  ...buildFixtureSnapshot(EVENING_FIXTURE),
  season,
  springStart,
  projected: true,
  teams: {},
  series: {},
  log: [],
  standings: { divisions: {} },
  slate: null,
});

test("the Season picker sets 16px, which an iPhone doesn't zoom into on a tap, and looks as big as the detail role's numbers", async ({
  page,
}) => {
  await openApp(page, { store: { "seasons/2025": SEASON_2025 } });
  await openSettings(page);
  const picker = page.locator("#seasonPicker");
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await checkSelectArrow(picker);
  }
  await expect(picker).toHaveCSS("font-size", "16px");
  const widths = await measureFieldFace(picker, "--type-detail-size", "var(--numbers)");
  expect(widths.field).toBeCloseTo(widths.role, 0);
});

test("the page shows the season the store says is current", async ({ page }) => {
  await openBracket(page, {
    now: "2027-02-19T15:00:00Z",
    store: {
      "live/current": { season: 2027 },
      "seasons/2027": buildSeasonRecord(buildEmptySeasonSnapshot(2027, "2027-02-19")),
    },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });

  await expect(page.locator("#seasonPicker")).toHaveValue("2027");
  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
});

test("a page left open turns over when the store moves on to a new season", async ({ page }) => {
  const app = await openBracket(page, {
    now: "2027-02-19T15:00:00Z",
    store: { "live/current": { season: 2026 } },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });
  await expect.poll(() => app.countOpenSockets()).toBe(1);
  await expect(page.locator("#seasonPicker")).toHaveValue("2026");

  // What the Worker's update saves once spring training has started.
  await app.writeFromWorker("live/current", { season: 2027 });

  await expect(page.locator("#seasonPicker")).toHaveValue("2027");
  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
});

test("while the store says last year's season is current, the page shows it and asks about no other", async ({
  page,
}) => {
  const app = await openApp(page, {
    now: "2027-02-18T15:00:00Z",
    store: { "live/current": { season: 2026 } },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });
  await expect(page.locator("#seasonPicker")).toHaveValue("2026");

  await page.clock.fastForward("02:00:00");

  await expect(page.locator("#seasonPicker")).toHaveValue("2026");
  expect(app.listStoreReads().filter((path) => path.includes("2027"))).toEqual([]);
});

for (const [theme, colorScheme] of /** @type {const} */ ([
  ["Ball", "light"],
  ["Night Game", "dark"],
])) {
  test(`in ${theme}, a club's game under way stays readable on its standings row pressed`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize(LAPTOP);
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const row = page.locator("#standingsWrap tr:has(td.next-cell.live)").first();
    const open = row.locator(".row-button-cell button");

    await pressOn(page, open);

    await expect(open).toHaveClass(/is-row-press/);
    expect(await listLowContrastTextAsShown(page)).toEqual([]);
    await page.mouse.up();
  });
}
