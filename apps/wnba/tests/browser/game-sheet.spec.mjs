import {
  test,
  expect,
  openApp,
  openGameSheet,
  findGameButton,
  keepHighlights,
  matchPath,
} from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import {
  recordSheetMotions,
  waitForTimedMotions,
} from "../../../../tests/browser/sheet-motions.mjs";
import { expectShown, expectSteppedAway } from "../../../../tests/browser/sheet-row.mjs";
import { comeBackTo, setHidden } from "../../../../tests/browser/visibility.mjs";
import {
  ACES_AT_FEVER,
  FEVER_AT_ACES,
  VALKYRIES_AT_WINGS,
  startValkyriesAtWings,
  finishValkyriesAtWings,
  countBoxScoreReads,
} from "./game-sheet-games.mjs";
import { readRole, readType } from "../../../../tests/browser/type-roles.mjs";

// Most of these tests are about what a sheet shows, so they skip the eased scrolling between the
// Games lists. The ones about how a sheet moves ask for full motion.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test("tapping a final opens its sheet with the score, the box score, and the top scorers, and its close button closes it", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);

  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("First Round Game 2");
  await expect(sheet.locator("#gameWhen")).toHaveText("Fever won to tie 1-1•Yesterday");
  await expect(sheet.locator(".faceoff .score")).toHaveText(/89\s*99/);
  await expect(sheet.locator(".faceoff-record")).toHaveText(["31-13", "28-16"]);
  await expect(sheet.locator(".line-score tbody tr").first()).toHaveText(
    /Aces\s*26\s*17\s*17\s*29\s*89/,
  );
  await expect(sheet.locator(".tape-label")).toHaveText([
    "Field goals",
    "3-pointers",
    "Free throws",
    "Rebounds",
    "Assists",
    "Turnovers",
    "Points in the paint",
    "Bench points",
  ]);
  await expect(sheet.locator(".tape-row").first().locator(".home .tape-bar i")).toHaveClass("lead");
  await expect(
    sheet.locator(".players tbody").nth(1).locator('th[scope="row"]').first(),
  ).toContainText("Caitlin Clark");
  await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out"]);

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});

/** @param {import("@playwright/test").Page} page */
const holdPageCode = (page) => holdRequests(page, matchPath("/js/app.js"));

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<string, string>} items what the page's storage holds before it loads
 */
const storeBeforeLoad = (page, items) =>
  page.addInitScript((stored) => {
    for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
  }, items);

/** @param {import("@playwright/test").Locator} sheet */
const readScrollTop = (sheet) => sheet.evaluate((element) => element.scrollTop);

// Text above what shows can change height by a pixel or two as the page's fonts arrive or it
// redraws, which the browser's scroll anchoring makes up for, keeping what shows where it was.
const ANCHORING_PX = 4;

/**
 * @param {import("@playwright/test").Locator} sheet
 * @param {number} scrollTop
 */
async function expectScrolledTo(sheet, scrollTop) {
  expect(Math.abs((await readScrollTop(sheet)) - scrollTop)).toBeLessThanOrEqual(ANCHORING_PX);
}

test("a reload shows the open sheet where it was scrolled before the page's code arrives, and the code keeps it there", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out"]);
  const section = sheet.locator("#gameSection");
  await section.evaluate((element) => {
    element.scrollTop = 200;
  });
  const release = await holdPageCode(page);
  const reads = countBoxScoreReads(page);

  await page.reload({ waitUntil: "commit" });

  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("First Round Game 2");
  await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out"]);
  await expectScrolledTo(section, 200);
  release();
  await expect.poll(() => reads.count).toBe(1);
  await expect(sheet.locator("#gameWhen")).toHaveText("Fever won to tie 1-1•Yesterday");
  await expectScrolledTo(section, 200);

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expect(sheet).toBeHidden();
});

test("a team's sheet open over a game's opens over it again on a reload, its back button still saying Game", async ({
  page,
}) => {
  await openApp(page);
  const gameSheet = await openGameSheet(page, ACES_AT_FEVER);
  await gameSheet
    .locator(".faceoff")
    .getByRole("button", { name: "Team details: Las Vegas Aces" })
    .click();
  const teamSheet = page.locator("#teamSheet");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");

  await page.reload();

  await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
  await expect(page.locator("#gameSheet")).toBeAttached();
  await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
  await expect(teamSheet).toBeHidden();
  await expect(page.locator("#gameSheet .foul-chip")).toHaveText(["Fouled out"]);
  await expect(page.locator("#gameSheet .foul-chip")).toBeVisible();
});

test("a team's sheet open over a game's opened from another team's opens there again on a reload, and back goes to the game, then to the first team", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("button", { name: "Team details: Las Vegas Aces" }).first().click();
  const teamSheet = page.locator("#teamSheet");
  await teamSheet.getByRole("button", { name: "Game details: Aces at Fever, Sep 29" }).click();
  const gameSheet = page.locator("#gameSheet");
  await gameSheet
    .locator(".faceoff")
    .getByRole("button", { name: "Team details: Indiana Fever" })
    .click();
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Indiana Fever");

  await page.reload();

  await expect(teamSheet.locator("#teamTitle")).toHaveText("Indiana Fever");
  await expect(page.locator("#sheetDialog .sheet-page:not([id]) .team-title")).toHaveText(
    "Las Vegas Aces",
  );
  await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
  await expect(gameSheet.locator(".foul-chip")).toBeVisible();
  await gameSheet.getByRole("button", { name: "Back to Team", exact: true }).click();
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
  await expect(teamSheet).toBeVisible();
  await expect(page.locator("#sheetDialog .sheet-page:not([id])")).toHaveCount(0);
});

test("a sheet whose game the season no longer has closes once the page's code arrives", async ({
  page,
}) => {
  await storeBeforeLoad(page, {
    openSheets: JSON.stringify([
      { id: "gameSheet", scrollTop: 0, subject: { id: "0000000000", kind: "box" } },
    ]),
  });

  await openApp(page);

  await expect(page.locator("#gameSheet")).toBeHidden();
});

const MINUTE_MS = 60 * 1000;
const SHEET_KEPT_MS = 6 * 60 * MINUTE_MS;

/**
 * Moves the page's clock on by `ms` without running its timers, as a phone that suspends it does.
 * @param {import("@playwright/test").Page} page
 * @param {number} ms
 */
const passTime = async (page, ms) =>
  page.clock.setSystemTime((await page.evaluate(() => Date.now())) + ms);

test("a sheet left off the screen six hours is closed as the page comes back, before it draws, and one left for less is still open", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out"]);

  await setHidden(page, true);
  await passTime(page, SHEET_KEPT_MS - MINUTE_MS);
  expect(await comeBackTo(page, "#sheetDialog")).toBe(true);
  await expect(sheet).toBeVisible();

  await setHidden(page, true);
  await passTime(page, SHEET_KEPT_MS);
  expect(await comeBackTo(page, "#sheetDialog")).toBe(false);
  await expect(sheet).toBeHidden();
});

test("a reload six hours after the page left the screen opens without the sheet it showed, before the page's code arrives", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out"]);
  await setHidden(page, true);
  await passTime(page, SHEET_KEPT_MS);
  const release = await holdPageCode(page);

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#bracketWrap")).toContainText("Fever");
  await expect(sheet).toBeHidden();
  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(sheet).toBeHidden();
});

test("a live game's sheet stays open however long the page is away, until an hour after its final shows", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(startValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".faceoff .score")).toHaveText(/74\s*72/);

  await setHidden(page, true);
  await passTime(page, 2 * SHEET_KEPT_MS);
  expect(await comeBackTo(page, "#sheetDialog")).toBe(true);
  await app.changeSeason(finishValkyriesAtWings);
  await expect(sheet.locator(".faceoff .score")).toHaveText(/100\s*108/);

  await setHidden(page, true);
  await passTime(page, 59 * MINUTE_MS);
  expect(await comeBackTo(page, "#sheetDialog")).toBe(true);

  await setHidden(page, true);
  await passTime(page, MINUTE_MS);
  expect(await comeBackTo(page, "#sheetDialog")).toBe(false);
});

test("a live game's sheet whose final came while the page was off the screen opens again on a reload however long after", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(startValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".faceoff .score")).toHaveText(/74\s*72/);
  await setHidden(page, true);
  await app.changeSeason(finishValkyriesAtWings);
  await expect(sheet.locator(".faceoff .score")).toHaveText(/100\s*108/);
  await passTime(page, 2 * 60 * MINUTE_MS);
  const release = await holdPageCode(page);

  await page.reload({ waitUntil: "commit" });

  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".faceoff .score")).toHaveText(/100\s*108/);
  release();
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "no-preference" },
  });

  test("a sheet the page shows again on a reload doesn't rise again, and rises when opened next", async ({
    page,
  }) => {
    const readMotions = await recordSheetMotions(page);
    await openApp(page);
    const sheet = await openGameSheet(page, ACES_AT_FEVER);
    await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out"]);
    const answered = page.waitForResponse(matchPath("/box-score"));
    const listSheetMotions = async () =>
      (await readMotions()).filter(({ id }) => id === "sheetDialog");

    await page.reload();

    await answered;
    await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out"]);
    expect(await listSheetMotions()).toEqual([]);
    await sheet.getByRole("button", { name: "Close" }).dispatchEvent("click");
    await expect(sheet).toBeHidden();
    await openGameSheet(page, ACES_AT_FEVER);
    await expect.poll(listSheetMotions).toContainEqual({
      id: "sheetDialog",
      part: "sheet",
      name: "sheet-rise",
    });
  });

  test("the game sheet rises to fill the screen, with its close button at its top left", async ({
    page,
  }) => {
    await openApp(page);
    const sheet = await openGameSheet(page, ACES_AT_FEVER);
    await waitForTimedMotions(page);
    const close = await sheet.getByRole("button", { name: "Close" }).boundingBox();
    expect([Math.round(close.x), close.width]).toEqual([6, 44]);
    expect(await sheet.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test("the game sheet's top holds still while its box score scrolls under it, and the box score never scrolls past its ends", async ({
    page,
  }) => {
    await openApp(page);
    const sheet = await openGameSheet(page, ACES_AT_FEVER);
    await expect(sheet.locator(".tape-row").first()).toBeVisible();
    const section = sheet.locator("#gameSection");
    await expect(section).toHaveCSS("overscroll-behavior-y", "none");

    await section.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(sheet.locator(".tape-row").first()).not.toBeInViewport();
    await expect(sheet.locator(".sheet-top")).toBeInViewport();
  });

  test("the game sheet rises with nothing dimming the page behind it, and its close button or Escape slides it down", async ({
    page,
  }) => {
    const readMotions = await recordSheetMotions(page);
    await openApp(page);
    const closings = {
      "the close button": () => page.locator("#gameCloseBtn").dispatchEvent("click"),
      Escape: () => page.keyboard.press("Escape"),
    };
    for (const [way, close] of Object.entries(closings)) {
      const sheet = await openGameSheet(page, ACES_AT_FEVER);
      await expect.poll(readMotions, way).toContainEqual({
        id: "sheetDialog",
        part: "sheet",
        name: "sheet-rise",
      });
      await waitForTimedMotions(page);
      await readMotions();
      const backdrop = await page
        .locator("#sheetDialog")
        .evaluate((dialog) => getComputedStyle(dialog, "::backdrop").backgroundColor);
      expect(backdrop, way).toBe("rgba(0, 0, 0, 0)");

      await close();
      await expect(sheet, way).toBeHidden();
      expect(await readMotions(), way).toEqual([
        { id: "sheetDialog", part: "sheet", to: { transform: "translateY(100%)" } },
      ]);
    }
  });
});

test("a game's row names its teams in their own type, and a tap anywhere on it, its teams' names too, opens the game", async ({
  page,
}) => {
  await openApp(page);
  const gameButton = await findGameButton(page, ACES_AT_FEVER);
  const row = gameButton.locator("xpath=..");
  const fever = row.locator(".game-side.home .team-name");
  await expect(fever).toHaveCSS("font-family", /^"Barlow Condensed"/);
  await expect(fever).toHaveCSS("font-weight", String((await readRole(page, "team")).weight));
  await expect(row.getByRole("button", { name: /^Team details/ })).toHaveCount(0);

  // The row's button lies over its names, so a click on a name lands on it.
  const box = await fever.boundingBox();
  if (!box) throw new Error("The Fever's name isn't shown");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#gameTitle")).toHaveText("First Round Game 2");
  await expect(page.locator("#teamSheet")).toBeHidden();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a tap on a team's name in a game's row opens the game, since a thumb lands on a name easily", async ({
    page,
  }) => {
    await openApp(page);
    const fever = (await findGameButton(page, ACES_AT_FEVER))
      .locator("xpath=..")
      .locator(".game-side.home .team-name");
    await fever.scrollIntoViewIfNeeded();
    const box = await fever.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.locator("#gameTitle")).toHaveText("First Round Game 2");
    await expect(page.locator("#teamSheet")).toBeHidden();
  });
});

test("a team's name in a game's sheet opens its sheet over the game's, with a back button in place of its close button that says Game and goes back to it", async ({
  page,
}) => {
  await openApp(page);
  await (await findGameButton(page, ACES_AT_FEVER)).click();
  const gameSheet = page.locator("#gameSheet");
  await expect(gameSheet.locator(".line-score")).toBeVisible();
  const teamSheet = page.locator("#teamSheet");

  for (const place of [".faceoff", ".line-score", ".players"]) {
    await gameSheet
      .locator(place)
      .first()
      .getByRole("button", { name: "Team details: Las Vegas Aces" })
      .click();
    await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
    await expectShown(teamSheet);
    await expectSteppedAway(gameSheet);
    await expect(teamSheet.getByRole("button", { name: "Close" })).toBeHidden();
    await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
    await expect(teamSheet).toBeHidden();
    await expectShown(gameSheet);
  }
});

test("Escape closes a team's sheet and the game's under it at once", async ({ page }) => {
  await openApp(page);
  await (await findGameButton(page, ACES_AT_FEVER)).click();
  const gameSheet = page.locator("#gameSheet");
  await gameSheet
    .locator(".faceoff")
    .getByRole("button", { name: "Team details: Las Vegas Aces" })
    .click();
  await expect(page.locator("#teamTitle")).toHaveText("Las Vegas Aces");

  await page.keyboard.press("Escape");
  await expect(page.locator("#teamSheet")).toBeHidden();
  await expect(gameSheet).toBeHidden();
});

test("going back from a team's sheet to a game's leaves no focus ring around the game's", async ({
  page,
}) => {
  await openApp(page);
  await (await findGameButton(page, ACES_AT_FEVER)).click();
  const gameSheet = page.locator("#gameSheet");
  await expect(gameSheet.locator(".line-score")).toBeVisible();
  // On an iPhone a tapped button never takes focus, so the game's sheet keeps it.
  await gameSheet.evaluate((dialog) => dialog.focus());
  await gameSheet
    .locator(".faceoff")
    .getByRole("button", { name: "Team details: Las Vegas Aces" })
    .dispatchEvent("click");
  const teamSheet = page.locator("#teamSheet");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");

  await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).dispatchEvent("click");
  await expect(teamSheet).toBeHidden();
  await expect(gameSheet).toBeFocused();
  await expect(gameSheet).toHaveCSS("outline-style", "none");
});

test("a final's sheet offers Game and Highlights pills, and its Highlights show ESPN's recap video, its title as heavy as each clip's, its story, and each clip", async ({
  page,
}) => {
  const app = await openApp(page);
  await keepHighlights(page, app, ACES_AT_FEVER);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.getByRole("tab")).toHaveText(["Game", "Highlights"]);
  await expect(sheet.getByRole("tab", { name: "Game" })).toHaveAttribute("aria-selected", "true");

  await sheet.getByRole("tab", { name: "Highlights" }).click();

  const body = sheet.locator("#highlightsBody");
  await expect(body.locator(".clip-feature .clip-title")).toHaveText(
    "Las Vegas Aces vs. Indiana Fever - Game Highlights",
  );
  await expect(body.locator(".clip-feature .clip-length")).toHaveText("1:09");
  await expect(body.getByRole("link", { name: /^Read on ESPN/ })).toHaveAttribute(
    "href",
    "https://www.espn.com/wnba/recap?gameId=401918022",
  );
  await expect(body.locator(".clip-row")).toHaveCount(13);
  await expect(body.locator(".clip-row").first().locator(".clip-title")).toHaveText(
    "Chelsea Gray knocks down the mid-range jumper",
  );
  expect((await readType(body.locator(".clip-feature .clip-title"))).weight).toBe(
    (await readType(body.locator(".clip-row .clip-title").first())).weight,
  );
  await expect(body.locator(".clip-meta")).toHaveCount(0);
});

test("a game still to be played, or being played, shows its preview or box score with no pills, even after a final's sheet did", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(startValkyriesAtWings);
  const final = await openGameSheet(page, ACES_AT_FEVER);
  await expect(final.getByRole("tab", { name: "Highlights" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(final).toBeHidden();
  for (const name of [FEVER_AT_ACES, VALKYRIES_AT_WINGS]) {
    const sheet = await openGameSheet(page, name);
    await expect(sheet.locator(".faceoff-score")).toBeVisible();
    await expect(sheet.locator(".sheet-top .pager-tabs"), name).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});

test("a reload on a final's Highlights shows its pills and its Highlights before the page's code arrives", async ({
  page,
}) => {
  const app = await openApp(page);
  await keepHighlights(page, app, ACES_AT_FEVER);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await sheet.getByRole("tab", { name: "Highlights" }).click();
  await expect(sheet.locator("#highlightsBody .clip-row")).toHaveCount(13);
  const release = await holdPageCode(page);

  await page.reload({ waitUntil: "commit" });

  await expect(sheet.getByRole("tab", { name: "Highlights" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(sheet.locator("#highlightsBody .clip-row").first()).toBeVisible();
  await expect(sheet.locator("#gameBody")).toBeHidden();
  release();
  await expect(sheet.locator("#highlightsBody .clip-row")).toHaveCount(13);
  await expect(sheet.getByRole("tab", { name: "Highlights" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
