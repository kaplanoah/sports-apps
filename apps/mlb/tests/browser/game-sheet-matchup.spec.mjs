import {
  test,
  expect,
  openApp,
  MATCHUP_STARTERS,
  buildSnapshotWithStarters,
  matchPath,
} from "./harness.mjs";
import {
  NEXT_DAY_GAMES,
  ASTROS_AT_ATHLETICS,
  BLUBAUGH_VS_SPRINGS,
  showGames,
  openGame,
  showSection,
  openMatchup,
} from "./open-game-sheet.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/** @param {import("@playwright/test").Page} page */
const holdPitchers = (page) => holdRequests(page, matchPath("/pitcher"));

/** @param {import("@playwright/test").Page} page */
function countPitcherReads(page) {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/pitcher") reads.count += 1;
  });
  return reads;
}

test("a tap on the starters slides to Matchup, with them face to face, and the close button closes it", async ({
  page,
}) => {
  const sheet = await openGame(page);
  await sheet.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
  await expect(sheet.getByRole("tab", { name: "Matchup" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(sheet.locator("#matchupSection")).toBeInViewport();
  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  await expect(sheet.locator(".pitcher-bio .arm")).toHaveText(["R", "L"]);
  await expect(sheet.locator(".pitcher-bio .arm").first()).toHaveAttribute(
    "title",
    "Throws right-handed",
  );
  await expect(sheet.locator(".pitcher-bio")).toHaveText(["RAge 27", "LAge 27"]);
  await expect(sheet.locator(".scout h3 span")).toHaveText(["What he throws", "What he throws"]);
  await expect(sheet.locator(".recent-starts").first()).toContainText(
    "Sep 19vs Mariners5 2/3 IP, 2 R, 6 K",
  );

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});

const isAstrosGame = (game) => game.away === "HOU" && game.home === "ATH";

/** @param {any} season @param {object[]} starters */
const setStarters = (season, starters) => ({
  ...season,
  slate: {
    ...season.slate,
    today: {
      ...season.slate.today,
      games: season.slate.today.games.map((game) =>
        isAstrosGame(game) ? { ...game, starters } : game,
      ),
    },
  },
});

test("a starter named after the sheet opened shows on its starters line and in its matchup", async ({
  page,
}) => {
  const named = buildSnapshotWithStarters();
  const [blubaugh, springs] = named.slate.today.games.find(isAstrosGame).starters;
  const app = await openApp(page, {
    snapshots: { 2026: setStarters(named, [blubaugh, { id: springs.id }]) },
    pitchers: MATCHUP_STARTERS,
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  const sheet = page.locator("#gameSheet");
  await expect(
    sheet.getByRole("button", { name: "Pitching matchup: Blubaugh vs TBD" }),
  ).toBeVisible();

  const season = await app.readDocument("seasons/2026");
  await app.writeFromWorker("seasons/2026", setStarters(season, [blubaugh, springs]));

  await expect(sheet.getByRole("button", { name: BLUBAUGH_VS_SPRINGS })).toBeVisible();
  await showSection(sheet, "Matchup");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
});

test("a starter still to be named says TBD level with the other's last name, and the clubs line up", async ({
  page,
}) => {
  const named = buildSnapshotWithStarters();
  const [blubaugh] = named.slate.today.games.find(isAstrosGame).starters;
  await openApp(page, {
    snapshots: { 2026: setStarters(named, [blubaugh]) },
    pitchers: MATCHUP_STARTERS,
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  const sheet = page.locator("#gameSheet");
  await showSection(sheet, "Matchup");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "TBD"]);
  /** @param {import("@playwright/test").Locator} locator */
  const readTops = (locator) =>
    locator.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().top)),
    );
  const [awayLast, homeLast] = await readTops(sheet.locator(".pitcher-last"));
  expect(homeLast).toBe(awayLast);
  const [awayClub, homeClub] = await readTops(sheet.locator(".pitcher-id .club"));
  expect(homeClub).toBe(awayClub);
});

test("a reload shows the open matchup before the page's code arrives, and the code reads its starters again", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  const release = await holdRequests(page, matchPath("/js/app.js"));
  const reads = countPitcherReads(page);

  await page.reload({ waitUntil: "commit" });

  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  release();
  await expect.poll(() => reads.count).toBe(2);
  await expect(sheet.getByRole("tab", { name: "Matchup" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(sheet.locator("#matchupSection")).toBeInViewport();
  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});

test("the sheet's parts and lists leave room between their rows", async ({ page }) => {
  const sheet = await openMatchup(page);
  const blubaugh = sheet.locator(".scout").first();
  await expect(blubaugh.locator(".pitch-name")).toHaveCount(3);
  const readGaps = (list) =>
    list.evaluateAll((items) =>
      items.slice(1).map((item, index) => {
        const above = items[index].getBoundingClientRect();
        return Math.round(item.getBoundingClientRect().top - above.bottom);
      }),
    );
  expect(await readGaps(blubaugh.locator(".pitch-name"))).toEqual([10, 10]);
  expect(await readGaps(blubaugh.locator(".recent-starts li"))).toEqual([8]);
  const rowsToLastStarts = await blubaugh.evaluate((scout) => {
    const rows = scout.querySelector(".pitch-rows").getBoundingClientRect();
    return scout.querySelector("h4").getBoundingClientRect().top - rows.bottom;
  });
  expect(Math.round(rowsToLastStarts)).toBe(20);
  const tapeToScout = await sheet.locator(".matchup-body").evaluate((body) => {
    const tape = body.querySelector(".tape").getBoundingClientRect();
    return body.querySelector(".scout").getBoundingClientRect().top - tape.bottom;
  });
  expect(Math.round(tapeToScout)).toBe(22);
});

/**
 * Where a finger on the middle of `target` lands.
 * @param {import("@playwright/test").Locator} target
 */
const isTapOnTarget = (target) =>
  target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const landed = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return element.contains(landed);
  });

test("a starter the Worker can't describe says so under his club, beside the other's numbers, and Try again shows his placeholders as it reads him again", async ({
  page,
}) => {
  /** @type {Record<number, object>} */
  const pitchers = { 1: MATCHUP_STARTERS[1] };
  const sheet = await openMatchup(page, pitchers);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(1);
  const retry = sheet.locator(".pitcher-id.home .retry-side");
  await expect(retry.locator(".retry-message")).toHaveText("Couldn't load");
  await expect(sheet.locator(".scout")).toHaveCount(1);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  pitchers[2] = MATCHUP_STARTERS[2];
  const release = await holdPitchers(page);
  const button = retry.getByRole("button", { name: "Try again" });
  expect(await isTapOnTarget(button)).toBe(true);
  await button.click();
  await expect(
    sheet.locator("#matchupBody .scout").nth(1).locator(".placeholder").first(),
  ).toBeVisible();
  await expect(retry).toHaveCount(0);
  release();
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
});

test("a starter's Couldn't load sits 11px under his club and a pixel right of the button's center, 3.5px over it, and the button 14px over the stats", async ({
  page,
}) => {
  const sheet = await openMatchup(page, { 1: MATCHUP_STARTERS[1] });
  const gaps = await sheet.locator("#matchupBody").evaluate((body) => {
    const box = (selector) =>
      /** @type {Element} */ (body.querySelector(selector)).getBoundingClientRect();
    const club = box(".pitcher-id.home .club");
    const message = box(".retry-side .retry-message");
    const button = box(".retry-side .retry-button");
    const stats = box(".tape");
    return {
      above: message.top - club.bottom,
      between: button.top - message.bottom,
      below: stats.top - button.bottom,
      right: Math.round(message.left + message.width / 2 - (button.left + button.width / 2)),
    };
  });
  expect(gaps).toEqual({ above: 11, between: 3.5, below: 14, right: 1 });
});

test("with neither starter's numbers loaded, the Matchup says why once, and reads them again as the phone comes back online", async ({
  page,
}) => {
  /** @type {Record<number, object>} */
  const pitchers = {};
  const sheet = await openMatchup(page, pitchers);
  const block = sheet.locator("#matchupBody .retry-block");
  await expect(block.locator(".retry-title")).toHaveText("The server had a problem");
  await expect(block.locator(".retry-next")).toHaveText("Try again to load starters' numbers");
  await expect(sheet.locator(".retry-side")).toHaveCount(0);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  Object.assign(pitchers, MATCHUP_STARTERS);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await expect(block).toHaveCount(0);
});

test("a game on a later day without its starters says to check back for them, under its clubs", async ({
  page,
}) => {
  const reads = countPitcherReads(page);
  await showGames(page);
  await page.locator(NEXT_DAY_GAMES).first().click();
  const sheet = page.locator("#gameSheet");
  await showSection(sheet, "Matchup");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["TBD", "TBD"]);
  await expect(sheet.locator(".pitcher-id .club")).toHaveCount(2);
  await expect(sheet.locator(".check-back")).toHaveText("Check back for pitchers");
  await expect(sheet.locator(".tape, .scout")).toHaveCount(0);
  expect(reads.count).toBe(0);
});

// What the Worker answers for the last starters of the Angels, who play at Seattle tonight.
const ANGELS_ROTATION = {
  club: "LAA",
  date: "2026-09-24",
  starters: [
    {
      id: 11,
      name: "Kochanowicz",
      hand: "R",
      start: { date: "2026-09-23", ip: "6.1", pitches: 98 },
      rest: 0,
    },
    {
      id: 12,
      name: "Soriano",
      hand: "R",
      start: { date: "2026-09-19", ip: "5.0", pitches: 101 },
      rest: 4,
    },
  ],
};

async function openTbd(page, rotations) {
  await openApp(page, { rotations });
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page
    .locator("#seasonGames .game-day.is-today .game-row")
    .filter({ hasText: "Angels" });
  await expect(row.locator(".starter.pending")).toHaveText(["TBD", "TBD"]);
  await row.locator(".game-open").click();
  const sheet = page.locator("#gameSheet");
  await showSection(sheet, "Matchup");
  return sheet;
}

test("a game later today without a starter says TBD, and opens to who started lately and how rested each is", async ({
  page,
}) => {
  const sheet = await openTbd(page, { LAA: ANGELS_ROTATION });
  await expect(sheet.locator(".pitcher-last")).toHaveText(["TBD", "TBD"]);
  const angels = sheet.locator(".scout").first();
  await expect(angels.locator("h3")).toHaveText("AngelsWho's rested");
  await expect(angels.locator(".scout-note")).toHaveText(
    "No starter named yet. Each recent starter's last start, and the rest he'd have on Sep 24.",
  );
  const starters = angels.locator(".rotation li");
  await expect(starters.first()).toHaveText(
    /Kochanowicz\s*R\s*6 1\/3 IP, 98 pitches\s*0 days' rest/,
  );
  await expect(starters.nth(1)).toHaveText(/Soriano\s*R\s*5 IP, 101 pitches\s*4 days' rest/);
  await expect(starters.nth(1)).toHaveClass("rested");
  await expect(starters.first()).not.toHaveClass("rested");
  const rotationGap = await angels.locator(".rotation").evaluate((list) => {
    const [above, below] = [...list.children].map((item) => item.getBoundingClientRect());
    return below.top - above.bottom;
  });
  expect(Math.round(rotationGap)).toBe(5);
  await expect(sheet.locator(".scout").nth(1).locator(".retry-message")).toHaveText(
    "Couldn't load who started lately",
  );
});

test("a club whose last starters didn't load reads them again on a tap on Try again", async ({
  page,
}) => {
  /** @type {Record<string, object>} */
  const rotations = { LAA: ANGELS_ROTATION };
  const sheet = await openTbd(page, rotations);
  const mariners = sheet.locator(".scout").nth(1);
  await expect(mariners.locator(".retry-message")).toHaveText("Couldn't load who started lately");
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  rotations.SEA = { ...ANGELS_ROTATION, club: "SEA" };
  const release = await holdRequests(page, matchPath("/rotation"));
  await mariners.getByRole("button", { name: "Try again" }).click();
  await expect(mariners.locator(".placeholder").first()).toBeVisible();
  release();
  await expect(mariners.locator(".rotation li")).toHaveCount(2);
});

test("while the starters' numbers load, the matchup holds their shape, then fills it in", async ({
  page,
}) => {
  await showGames(page);
  const release = await holdPitchers(page);
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  const sheet = page.locator("#gameSheet");
  await sheet.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
  const body = sheet.locator("#matchupBody");

  await expect(body).toHaveAttribute("aria-busy", "true");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  await expect(sheet.locator(".pitcher-first .placeholder")).toHaveCount(2);
  await expect(sheet.locator(".tape-label")).toHaveText(["ERA", "K/9", "BB/9", "Fastball mph"]);
  await expect(sheet.locator(".scout h3 span")).toHaveText(["What he throws", "What he throws"]);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await expect(sheet.locator(".recent-starts li")).toHaveCount(6);

  release();
  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
  await expect(body).toHaveAttribute("aria-busy", "false");
});

test("while a club's last starters load, its side holds a list's shape, then fills it in", async ({
  page,
}) => {
  await openApp(page, { rotations: { LAA: ANGELS_ROTATION } });
  await page.getByRole("tab", { name: "Games" }).click();
  const release = await holdRequests(page, matchPath("/rotation"));
  const row = page
    .locator("#seasonGames .game-day.is-today .game-row")
    .filter({ hasText: "Angels" });
  await row.locator(".game-open").click();
  const sheet = page.locator("#gameSheet");
  await showSection(sheet, "Matchup");
  const angels = sheet.locator(".scout").first();

  await expect(angels.locator("h3")).toHaveText("AngelsWho's rested");
  await expect(angels.locator(".rotation li")).toHaveCount(5);
  await expect(angels.locator(".placeholder").first()).toBeVisible();

  release();
  await expect(angels.locator(".rotation li")).toHaveCount(2);
  await expect(angels.locator(".placeholder")).toHaveCount(0);
});

test("a finger coming down on a game starts reading its starters' numbers", async ({ page }) => {
  await showGames(page);
  const reads = countPitcherReads(page);
  const button = page.getByRole("button", { name: ASTROS_AT_ATHLETICS });

  await button.dispatchEvent("pointerdown");
  await expect.poll(() => reads.count).toBe(2);

  await button.click();
  await expect(page.locator("#gameSheet").locator(".pitch-mix")).toHaveCount(2);
  expect(reads.count).toBe(2);
});
