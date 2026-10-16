import {
  test,
  expect,
  openApp,
  openBracket,
  openSettings,
  buildFixtureSnapshot,
  buildSnapshotWithStarters,
  BROADCASTS_FIXTURE,
  EVENING_FIXTURE,
  ON_A_PHONE,
  PITCHER_SIDES,
  PLAYER_DOCS,
  ROSTER_DOCS,
  SEASON_2025,
  chooseSeason,
  matchPath,
  readColor,
} from "./harness.mjs";
import { nameClubFully } from "../../page/js/clubs.js";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { expectShown, expectSteppedAway } from "../../../../tests/browser/sheet-row.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { checkRanksAreDim } from "../../../../tests/browser/rank-ink.mjs";
import { measurePlacedLegend } from "../../../../tests/browser/placed-legend.mjs";
import { findSeasonTab, openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const ASTROS_AT_ATHLETICS = "Game details: Astros at Athletics, Thu, Sep 24";

/** @param {import("@playwright/test").Page} page */
async function showGames(page) {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  return page.getByRole("button", { name: ASTROS_AT_ATHLETICS });
}

test("a game's row names its clubs plainly, and a tap anywhere on it, their names too, opens the game", async ({
  page,
}) => {
  const gameButton = await showGames(page);
  const row = gameButton.locator("xpath=..");
  await expect(row.getByRole("button", { name: /^Team details/ })).toHaveCount(0);

  // The row's button lies over its names, so a click on a name lands on it.
  await row.scrollIntoViewIfNeeded();
  const astros = await row.locator(".game-side.away .club").boundingBox();
  if (!astros) throw new Error("The Astros' name isn't shown");
  await page.mouse.click(astros.x + astros.width / 2, astros.y + astros.height / 2);
  await expect(page.locator("#gameSheet")).toBeVisible();
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a club's sheet open over a game's on a reload shows again over it, with a back button in place of its close button, and Escape closes both", async ({
  page,
}) => {
  await (await showGames(page)).click();
  const gameSheet = page.locator("#gameSheet");
  await gameSheet.getByRole("button", { name: "Team details: Astros" }).first().click();
  const teamSheet = page.locator("#teamSheet");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Houston Astros");

  await page.reload();

  await expect(teamSheet.locator("#teamTitle")).toHaveText("Houston Astros");
  await expect(teamSheet.locator("#teamNote")).toContainText("AL West");
  await expect(teamSheet.getByRole("button", { name: "Back to Game", exact: true })).toBeVisible();
  await expect(teamSheet.getByRole("button", { name: "Close" })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(teamSheet).toBeHidden();
  await expect(gameSheet).toBeHidden();
});

// The White Sox clinching with their 9-1 win at Kansas City, one of the evening's finals.
function buildSnapshotWithClinch() {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  snapshot.log = [
    {
      at: "2026-09-24T20:50:00Z",
      kind: "berth",
      team: "CWS",
      what: "playoff",
      via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
    },
  ];
  return snapshot;
}

/** @param {import("@playwright/test").Page} page */
async function showClinch(page) {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithClinch() } });
  const update = page.locator("#updates li").first();
  await expect(update.locator(".what")).toContainText("White Sox");
  return update;
}

/**
 * Taps the middle of `target` with a finger.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} target
 */
async function tapOn(page, target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("on a phone", () => {
  test.use(ON_A_PHONE);

  test("every club's sheet title, its city and name, fits on one line on a phone as narrow as 375px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const clubs = await page
      .locator(".div-grid tr[data-team]")
      .evaluateAll((rows) =>
        rows.map((row) => /** @type {HTMLElement} */ (row).dataset.team ?? ""),
      );
    expect(clubs).toHaveLength(30);
    const sheet = page.locator("#teamSheet");
    /** @type {string[]} */
    const wrapped = [];
    for (const club of clubs) {
      await page.locator(`.div-grid tr[data-team="${club}"] .team-open`).click();
      const title = sheet.locator("#teamTitle");
      await expect(title).toHaveText(nameClubFully(club));
      const lines = await title.evaluate((element) => {
        const name = document.createRange();
        name.selectNodeContents(
          /** @type {Element} */ (element.querySelector(":scope > span:not(.dot)")),
        );
        return new Set([...name.getClientRects()].map((line) => Math.round(line.bottom))).size;
      });
      if (lines > 1) wrapped.push(club);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
    expect(wrapped).toEqual([]);
  });

  test("an update about a game opens its sheet", async ({ page }) => {
    const update = await showClinch(page);

    await tapOn(page, update.getByRole("button", { name: /^Game details/ }));

    await expect(page.locator("#gameBody")).toContainText(/White Sox[\s\S]*Royals/);
    await expect(page.locator("#teamSheet")).toBeHidden();
  });

  test("a tap on a club's name in an update about a game opens the game's sheet", async ({
    page,
  }) => {
    const update = await showClinch(page);
    await tapOn(page, update.getByRole("button", { name: "Team details: White Sox" }));

    await expect(page.locator("#gameBody")).toContainText(/White Sox[\s\S]*Royals/);
    await expect(page.locator("#teamSheet")).toBeHidden();
  });

  test("a tap on a club's name in a game's row opens the game, since a thumb lands on a name easily", async ({
    page,
  }) => {
    const gameButton = await showGames(page);
    await tapOn(page, gameButton.locator("xpath=..").locator(".game-side.away .club"));

    await expect(page.locator("#gameSheet")).toBeVisible();
    await expect(page.locator("#teamSheet")).toBeHidden();
  });

  test("a tap anywhere on a club's row in the standings, beside its name or on its numbers, lands on the club's button and opens its sheet, and the table scrolls no wider than it is", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const row = page.locator('.div-grid tr[data-team="SEA"]');
    await row.scrollIntoViewIfNeeded();
    const spots = await row.locator("td").evaluateAll((cells) =>
      cells
        .map((cell) => cell.getBoundingClientRect())
        .filter((box) => box.right <= innerWidth)
        .map((box) => ({ x: box.right - 2, y: box.top + box.height / 2 })),
    );
    expect(spots.length).toBeGreaterThan(4);
    for (const spot of spots) {
      const target = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.team,
        spot,
      );
      expect(target).toBe("SEA");
    }
    const [scrolled, table] = await row.evaluate((tr) => [
      tr.closest(".st-scroll").scrollWidth,
      tr.closest("table").offsetWidth,
    ]);
    expect(scrolled).toBe(table);

    await page.touchscreen.tap(spots.at(-1).x, spots.at(-1).y);
    await expect(page.locator("#teamSheet #teamTitle")).toHaveText(/Mariners/);
  });
});

test("a club's name in a game's sheet opens its sheet over it, whose back button goes back to the game", async ({
  page,
}) => {
  await (await showGames(page)).click();
  const gameSheet = page.locator("#gameSheet");
  await gameSheet.getByRole("button", { name: "Team details: Athletics" }).first().click();
  const teamSheet = page.locator("#teamSheet");

  await expect(teamSheet.locator("#teamTitle")).toHaveText("Athletics");
  await expectShown(teamSheet);
  await expectSteppedAway(gameSheet);
  await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
  await expect(teamSheet).toBeHidden();
  await expectShown(gameSheet);
});

test("a club's row in the standings opens its sheet, with its nearest games, race, leaders, and titles, and its close button closes it", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await page.locator('.div-grid tr[data-team="SEA"] .team-open').click();
  const sheet = page.locator("#teamSheet");

  await expect(sheet.locator("#teamTitle")).toHaveText(/Mariners/);
  await expect(sheet.locator("#teamBody .sheet-part h3")).toHaveText([
    "Regular season",
    "Leaders",
    "Titles",
  ]);
  await expect(sheet.locator(".team-stat .team-label").first()).toHaveText("AL West");
  await expect(sheet.locator(".game-card h3")).toHaveText(["Last game", "Next game"]);
  await expect(sheet.locator(".team-titles")).toHaveText("None yet");
  await expect(sheet).toContainText("Since 1977");

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});

test("a club in the bracket opens its sheet", async ({ page }) => {
  await openBracket(page);
  const club = page.locator("#bracketWrap .team-id .team-open").first();
  const name = await club.locator(".team-name").textContent();
  await club.click();

  await expect(page.locator("#teamSheet #teamTitle")).toHaveText(new RegExp(name));
});

test.describe("on a phone's touchscreen", () => {
  test.use(ON_A_PHONE);

  test("a tap anywhere on a club's row in the bracket, beside its name or on its wins, lands on the club's button and opens its sheet", async ({
    page,
  }) => {
    await openApp(page, { store: { "seasons/2025": SEASON_2025 } });
    await chooseSeason(page, "2025");
    const row = page
      .locator("#bracketWrap .series")
      .filter({ hasText: "Reds" })
      .locator(".matchup-row")
      .filter({ hasText: "Dodgers" });
    await expect(row).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    const [name, wins] = await Promise.all(
      [row.locator(".team-name"), row.locator(".nscore")].map((part) => part.boundingBox()),
    );
    const besideName = { x: (name.x + name.width + wins.x) / 2, y: name.y + name.height / 2 };
    const onWins = { x: wins.x + wins.width / 2, y: wins.y + wins.height / 2 };
    for (const spot of [besideName, onWins]) {
      const target = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.team,
        spot,
      );
      expect(target).toBe("LAD");
    }

    await page.touchscreen.tap(besideName.x, besideName.y);
    await expect(page.locator("#teamSheet #teamTitle")).toHaveText(/Dodgers/);
  });
});

test("a club in the ranking stays a handle to drag, not a way to its sheet", async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  const firstClub = page.locator("#rankList .rank-item .club").first();
  await expect(firstClub).toBeVisible();

  await expect(page.locator("#rankList .team-open")).toHaveCount(0);
  await firstClub.click();
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test("a club's sheet title is its dot and name with its city, and no rank tag, in the page's own type, not in capitals, over highlighted part titles and dim labels", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await page.locator('.div-grid tr[data-team="SEA"] .team-open').click();
  const title = page.locator("#teamSheet #teamTitle");

  await expect(title.locator(".dot")).toBeVisible();
  await expect(title).toHaveText("Seattle Mariners");
  await expect(title.locator(".rank-tag")).toHaveCount(0);
  await expect(title).toHaveCSS("font-family", /^"Libre Franklin"/);
  await expect(title).toHaveCSS("text-transform", "none");
  await expect(page.locator("#teamSheet .sheet-part h3").first()).toHaveCSS(
    "color",
    await readColor(page, "--highlight"),
  );
  await expect(page.locator("#teamSheet .team-stat .team-label").first()).toHaveCSS(
    "color",
    await readColor(page, "--ink-dim"),
  );
});

test("a page last left on the Teams tab, which it no longer has, opens on its first tab", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "reference"));
  await openApp(page);

  await expect(findSeasonTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-bracket-standings")).toBeVisible();
});

test("a club's name under the pointer shifts its color a little toward the accent, with no underline", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const name = page.locator('.div-grid tr[data-team="SEA"] .team-open').locator(".team-name");
  const readNameColor = () => name.evaluate((element) => getComputedStyle(element).color);
  const before = await readNameColor();
  await name.hover();

  await expect.poll(readNameColor).not.toBe(before);
  await expect(name).toHaveCSS("text-decoration-line", "none");
});

test.describe("on a phone", () => {
  test.use(ON_A_PHONE);

  test("a finger on a club's card of a game lands on its button, and opens the game's sheet over the club's, which its back arrow returns to", async ({
    page,
  }) => {
    await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
    await openSeasonPart(page, "Standings");
    await page.locator('.div-grid tr[data-team="HOU"] .team-open').click();
    const teamSheet = page.locator("#teamSheet");
    await expect(teamSheet.locator(".game-card h3")).toHaveText(["Last game", "Next game"]);
    const card = teamSheet.getByRole("button", { name: ASTROS_AT_ATHLETICS });
    await expect(card).toContainText("@");

    const box = await card.boundingBox();
    if (!box) throw new Error("The card isn't shown");
    const spot = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const landsOn = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.game,
      spot,
    );
    expect(landsOn).toBe("2026-09-24 HOU ATH 1");
    await page.touchscreen.tap(spot.x, spot.y);

    const gameSheet = page.locator("#gameSheet");
    await expect(gameSheet.getByRole("heading", { level: 2 })).toHaveText("Astros @ Athletics");
    await expectShown(gameSheet);
    await expectSteppedAway(teamSheet);
    await gameSheet.getByRole("button", { name: "Back to Team", exact: true }).click();
    await expectShown(teamSheet);
    await expect(gameSheet).toBeHidden();
  });
});

/**
 * Opens a club's sheet from the standings, with the rosters the store keeps.
 * @param {import("@playwright/test").Page} page
 * @param {string} club
 * @param {{ store?: Record<string, object> }} [options]
 */
async function openClub(page, club, { store = ROSTER_DOCS } = {}) {
  await openApp(page, { store });
  await openSeasonPart(page, "Standings");
  await page.locator(`.div-grid tr[data-team="${club}"] .team-open`).click();
  return page.locator("#teamSheet");
}

test("a club's Roster pill slides to its hitters, starters, and bullpen, each name whole", async ({
  page,
}) => {
  const sheet = await openClub(page, "LAD");
  await sheet.getByRole("tab", { name: "Roster" }).click();
  await expect(sheet.locator("#rosterSection")).toBeInViewport();
  await expect(sheet.locator("#rosterBody .sheet-part-head h3")).toHaveText([
    "Hitters",
    "Starters",
    "Bullpen",
    "Injured list",
  ]);
  // Each row's button reaches over the whole row, so a name is whole when it ends before the
  // row's first number.
  const squeezed = await sheet.locator("#rosterBody tbody tr").evaluateAll((rows) =>
    rows
      .filter((row) => {
        const name = row.querySelector(".box-pos")?.getBoundingClientRect().right ?? 0;
        const number = row.querySelector("td.tabular")?.getBoundingClientRect().left ?? Infinity;
        return name > number;
      })
      .map((row) => row.textContent),
  );
  expect(squeezed).toEqual([]);
  const countWideTables = () =>
    sheet
      .locator("#rosterBody .box-wrap")
      .evaluateAll((wraps) => wraps.filter((wrap) => wrap.scrollWidth > wrap.clientWidth).length);
  expect(await countWideTables()).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await countWideTables()).toBe(0);
});

test("a past season's club says rosters show for the current season only", async ({ page }) => {
  await openApp(page, { store: { ...ROSTER_DOCS, "seasons/2025": SEASON_2025 } });
  await chooseSeason(page, "2025");
  await openSeasonPart(page, "Standings");
  await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
  const sheet = page.locator("#teamSheet");
  await sheet.getByRole("tab", { name: "Roster" }).click();
  await expect(sheet.locator("#rosterBody")).toHaveText("Rosters show for the current season only");
});

/**
 * Opens a club's Roster section, with every recorded player and starter the store keeps.
 * @param {import("@playwright/test").Page} page
 * @param {string} club
 */
async function openRoster(page, club) {
  await openApp(page, { store: { ...ROSTER_DOCS, ...PLAYER_DOCS }, pitchers: PITCHER_SIDES });
  await openSeasonPart(page, "Standings");
  await page.locator(`.div-grid tr[data-team="${club}"] .team-open`).click();
  const sheet = page.locator("#teamSheet");
  await sheet.getByRole("tab", { name: "Roster" }).click();
  return sheet;
}

test("a tap anywhere on a roster's row opens its player's sheet over the club's, which a back arrow returns to", async ({
  page,
}) => {
  const sheet = await openRoster(page, "CLE");
  const row = sheet.locator("#rosterBody tr").filter({ hasText: "Steven Kwan" });
  const average = await row.locator("td.tabular").first().boundingBox();
  if (!average) throw new Error("Kwan's row isn't shown");
  const landsOn = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.player ?? null,
    { x: average.x + average.width / 2, y: average.y + average.height / 2 },
  );
  expect(landsOn).toBe("680757");
  await page.mouse.click(average.x + average.width / 2, average.y + average.height / 2);

  const playerSheet = page.locator("#playerSheet");
  await expect(playerSheet.locator("#playerTitle")).toHaveText("Steven Kwan");
  await expect(playerSheet.locator("#playerPlace")).toHaveText("Los Gatos, CA");
  await expect(playerSheet.locator(".player-rank-row")).toHaveCount(10);
  await expect(playerSheet.locator(".player-curve svg")).toHaveCount(10);
  const back = playerSheet.getByRole("button", { name: "Back" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(sheet.locator("#teamTitle")).toContainText("Guardians");
  await expect(playerSheet).toBeHidden();
});

test("a starter's sheet ranks him among the qualified starters, each rank all in the dim color, and shows what he throws", async ({
  page,
}) => {
  const sheet = await openRoster(page, "CLE");
  await sheet.getByRole("button", { name: "Tanner Bibee" }).click();
  const playerSheet = page.locator("#playerSheet");
  await expect(playerSheet.locator(".player-rank-label")).toHaveText([
    "ERA",
    "K/9",
    "BB/9",
    "Velo",
  ]);
  await expect(playerSheet.locator(".pitch-mix")).toBeVisible();
  expect(await checkRanksAreDim(playerSheet, ".player-rank")).toEqual(Array(4).fill(true));
});

/**
 * Has the store's documents under `path` answer with an error until the returned function is
 * called.
 * @param {import("@playwright/test").Page} page
 * @param {string} path
 */
async function failStoreReads(page, path) {
  const pattern = matchPath(path);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) => route.fulfill({ status: 500, json: { error: "test" } });
  await page.route(pattern, refuse);
  return () => page.unroute(pattern, refuse);
}

test("a player's sheet that didn't load says so over Try again, which shows his placeholders as it reads him again", async ({
  page,
}) => {
  const sheet = await openRoster(page, "CLE");
  await expect(sheet.locator("#rosterBody .box-name").first()).toHaveText("Jo Adell");
  const answer = await failStoreReads(page, "/store/players/");
  await sheet.getByRole("button", { name: "Steven Kwan" }).click();
  const playerSheet = page.locator("#playerSheet");
  const block = playerSheet.locator("#playerBody .retry-block");
  await expect(block.locator(".retry-title")).toHaveText("The server had a problem");
  await expect(block.locator(".retry-next")).toHaveText("Try again to load his numbers");
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await answer();
  const release = await holdRequests(page, matchPath("/store/players/"));
  await block.getByRole("button", { name: "Try again" }).click();
  await expect(playerSheet.locator("#playerBody .placeholder").first()).toBeVisible();
  release();
  await expect(playerSheet.locator(".player-curve svg")).toHaveCount(10);
});

test("a roster that didn't load says so over Try again, and reads again as the page comes back", async ({
  page,
}) => {
  await openApp(page, { store: { ...ROSTER_DOCS, ...PLAYER_DOCS }, pitchers: PITCHER_SIDES });
  const answer = await failStoreReads(page, "/store/rosters/CLE");
  await openSeasonPart(page, "Standings");
  await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
  const sheet = page.locator("#teamSheet");
  await sheet.getByRole("tab", { name: "Roster" }).click();
  const block = sheet.locator("#rosterBody .retry-block");
  await expect(block.locator(".retry-title")).toHaveText("The server had a problem");
  await expect(block.locator(".retry-next")).toHaveText("Try again to load roster");
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await answer();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(sheet.locator("#rosterBody .box-name").first()).toHaveText("Jo Adell");
});

test("a club's leaders show under its season once its roster is read, and a tap anywhere on a leader's row opens his sheet over the club's", async ({
  page,
}) => {
  await openApp(page, { store: { ...ROSTER_DOCS, ...PLAYER_DOCS }, pitchers: PITCHER_SIDES });
  await openSeasonPart(page, "Standings");
  await page.locator('.div-grid tr[data-team="LAD"] .team-open').click();
  const sheet = page.locator("#teamSheet");
  const leaders = sheet.locator(".leaders");
  await expect(leaders.locator(".leader-stat")).toHaveText([
    "AVG",
    "OPS",
    "HR",
    "RBI",
    "SB",
    "ERA",
    "K",
    "IP",
    "SV",
  ]);
  await expect(sheet.locator("#teamBody .sheet-part h3")).toHaveText([
    "Regular season",
    "Leaders",
    "Titles",
  ]);

  const row = leaders.locator("tr").filter({ hasText: "Tanner Scott" });
  await row.scrollIntoViewIfNeeded();
  const saves = await row.locator("td.tabular").boundingBox();
  if (!saves) throw new Error("Scott's row isn't shown");
  const landsOn = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.player ?? null,
    { x: saves.x + saves.width / 2, y: saves.y + saves.height / 2 },
  );
  expect(landsOn).toBe(await row.locator("button.player-open").getAttribute("data-player"));
  await page.mouse.click(saves.x + saves.width / 2, saves.y + saves.height / 2);
  await expect(page.locator("#playerSheet #playerTitle")).toHaveText("Tanner Scott");
  await page.locator("#playerSheet").getByRole("button", { name: "Back" }).click();
  await expect(sheet.locator("#teamTitle")).toContainText("Dodgers");
});

test("a club's playoff lines run dashed past the regular season's range, each a whole gap from the solid line, under a legend 20px below the last line, its two lines 11px apart, and 23px over the Regular season title", async ({
  page,
}) => {
  // The recorded standings carry no runs, so each club scores and allows 4 to 5.45 runs a game,
  // which the Yankees' and the field's playoff runs reach past.
  const snapshot = buildFixtureSnapshot(BROADCASTS_FIXTURE);
  Object.values(snapshot.standings.divisions)
    .flat()
    .forEach((row, index) => {
      const games = row.w + row.l;
      row.rs = Math.round((4 + index / 20) * games);
      row.ra = Math.round((5.45 - index / 20) * games);
    });
  await openApp(page, { now: BROADCASTS_FIXTURE.now, snapshots: { 2026: snapshot } });
  await openSeasonPart(page, "Standings");
  await page.locator('.div-grid tr[data-team="NYY"] .team-open').click();
  const sheet = page.locator("#teamSheet");
  await expect(sheet.locator(".placed-legend")).toHaveText(
    "Regular season range for all teamsPlayoffs range, beyond regular season range",
  );

  const layout = await measurePlacedLegend(sheet);
  expect(layout.above).toBeCloseTo(20, 0);
  expect(layout.between).toBeCloseTo(11, 0);
  expect(layout.below).toBeCloseTo(23, 0);
  expect(layout.dashes.length).toBeGreaterThan(0);
  for (const dash of layout.dashes) {
    expect(dash.meets).toBeCloseTo(0, 1);
    expect(dash.isGapFirst).toBe(true);
  }
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});
