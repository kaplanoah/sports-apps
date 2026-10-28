import { test, expect, openApp } from "./harness.mjs";
import { waitForTimedAnimations } from "../../../../tests/browser/animations.mjs";
import { recordSheetMotions } from "../../../../tests/browser/sheet-motions.mjs";
import { expectShown, readLeft } from "../../../../tests/browser/sheet-row.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { THEMES } from "../../../../tests/browser/theme-layout.mjs";

const PHONE = { width: 390, height: 844 };
// The room between two sheets side by side, which the WNBA's --sheet-gap sets.
const GAP_PX = 15;
// How far under a band's top every sheet's close or back button sits.
const BUTTON_TOP_PX = 10;
const ACES_AT_FEVER = "Game details: Aces at Fever, First Round Game 2";

/**
 * Opens the Aces at the Fever's sheet, from the Games view.
 * @param {import("@playwright/test").Page} page
 */
async function openGame(page) {
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator("#seasonGames").getByRole("button", { name: ACES_AT_FEVER }).click();
  const gameSheet = page.locator("#gameSheet");
  await expect(gameSheet.locator(".line-score")).toBeVisible();
  return gameSheet;
}

/**
 * Opens the Aces at the Fever's sheet, then the Fever's beside it.
 * @param {import("@playwright/test").Page} page
 */
async function openFeverFromGame(page) {
  const gameSheet = await openGame(page);
  await gameSheet
    .locator(".faceoff")
    .getByRole("button", { name: /Fever\b.*team details$/ })
    .click();
  const teamSheet = page.locator("#teamSheet");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Indiana Fever");
  await expectShown(teamSheet);
  return { gameSheet, teamSheet };
}

/**
 * Opens the Aces' sheet, then the sheet of their game at the Fever from its card, then the Fever's
 * from the game's.
 * @param {import("@playwright/test").Page} page
 */
async function openFeverFromAcesGame(page) {
  await page
    .getByRole("button", { name: /Aces\b.*team details$/ })
    .first()
    .click();
  const teamSheet = page.locator("#teamSheet");
  await expectShown(teamSheet);
  await teamSheet.getByRole("button", { name: /^Yesterday\b.*game details$/ }).click();
  const gameSheet = page.locator("#gameSheet");
  await expect(gameSheet.locator(".line-score")).toBeVisible();
  await expectShown(gameSheet);
  return { teamSheet, gameSheet };
}

const FEVER_IN_GAME = '#gameSheet .faceoff .team-open[data-team="IND"]';

/**
 * Notes where a sheet is on each frame it's in the row, until the returned function stops and
 * reads the notes. A sheet named by its title is whichever one shows it, a copy or the sheet
 * itself. With `tap`, the first note is the first frame after a click on what it names.
 * @param {import("@playwright/test").Page} page
 * @param {{ id?: string, title?: string, tap?: string }} sheet
 */
async function startTrackingLeft(page, { id, title, tap }) {
  await page.evaluate(
    ([sheetId, sheetTitle, tapped]) => {
      const row = /** @type {Element} */ (document.querySelector("#sheetDialog .sheet-row"));
      const findSheet = () =>
        sheetId
          ? /** @type {HTMLElement} */ (document.getElementById(sheetId))
          : [...row.querySelectorAll(":scope > .sheet-page")].find(
              (sheet) => sheet.querySelector(".team-title")?.textContent === sheetTitle,
            );
      const lefts = /** @type {number[]} */ ([]);
      const note = () => {
        const sheet = findSheet();
        if (sheet && !(/** @type {HTMLElement} */ (sheet).hidden))
          lefts.push(Math.round(sheet.getBoundingClientRect().x - row.getBoundingClientRect().x));
        if (!(/** @type {any} */ (window).isTrackingDone)) requestAnimationFrame(note);
      };
      Object.assign(window, { trackedLefts: lefts, isTrackingDone: false });
      if (tapped) /** @type {HTMLElement} */ (document.querySelector(tapped)).click();
      requestAnimationFrame(note);
    },
    [id, title, tap],
  );
  return () =>
    page.evaluate(() => {
      Object.assign(window, { isTrackingDone: true });
      return /** @type {number[]} */ (/** @type {any} */ (window).trackedLefts);
    });
}

/**
 * Where the player's sheet and the game's are, read on one frame, once the row has stopped moving
 * under a finger held still: the browser may still be applying the finger's last moves.
 * @param {import("@playwright/test").Page} page
 */
const readRestingLefts = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const row = /** @type {Element} */ (document.querySelector("#sheetDialog .sheet-row"));
        const readLeft = (/** @type {string} */ selector) =>
          /** @type {Element} */ (document.querySelector(selector)).getBoundingClientRect().x -
          row.getBoundingClientRect().x;
        const read = () => ({
          playerLeft: readLeft("#playerSheet"),
          gameLeft: readLeft("#gameSheet"),
        });
        let last = read();
        const readOnRest = () =>
          requestAnimationFrame(() => {
            const now = read();
            if (now.playerLeft === last.playerLeft) resolve(now);
            else {
              last = now;
              readOnRest();
            }
          });
        readOnRest();
      }),
  );

/**
 * A color a token names, as the page computes it.
 * @param {import("@playwright/test").Page} page
 * @param {string} token
 */
const readTokenColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.backgroundColor = `var(${name})`;
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, token);

/**
 * Whether each step goes the same way as the first, never back.
 * @param {number[]} lefts
 */
function isMonotonic(lefts) {
  const steps = lefts.slice(1).map((left, index) => left - lefts[index]);
  return steps.every((step) => step >= 0) || steps.every((step) => step <= 0);
}

/**
 * Whether the sheet was seen somewhere between where it started and where it ended, as in a
 * slide and never in a jump. A busy machine draws only a few of a slide's frames, so how many
 * places it was seen in says nothing.
 * @param {number[]} lefts
 */
function hasStopOnTheWay(lefts) {
  const [low, high] = [Math.min(lefts[0], lefts.at(-1)), Math.max(lefts[0], lefts.at(-1))];
  return lefts.some((left) => left > low && left < high);
}

test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("every sheet's top is a band of the floor's color over the card's, ending in a line and edged on no other side at rest, with its close or back button in one spot, and a game's band holds its teams", async ({
    page,
  }) => {
    await openApp(page);
    const { teamSheet } = await openFeverFromGame(page);
    await teamSheet.getByRole("tab", { name: "Roster" }).click();
    await page.locator("#rosterSection").getByRole("button", { name: "Aliyah Boston" }).click();
    await expect(page.locator("#playerSheet .player-facts")).toBeVisible();
    const [floor, card, line] = await Promise.all(
      ["--bg", "--card", "--edge"].map((token) => readTokenColor(page, token)),
    );

    const sheets = await page.locator(".sheet-page").evaluateAll((pages) =>
      pages.map((sheet) => {
        const top = /** @type {Element} */ (sheet.querySelector(".sheet-top"));
        const style = getComputedStyle(top);
        const button = /** @type {Element} */ (
          [...top.querySelectorAll(".sheet-close, .sheet-back")].find(
            (element) => getComputedStyle(element).display !== "none",
          )
        );
        return {
          id: sheet.id,
          sheet: getComputedStyle(sheet).backgroundColor,
          band: style.backgroundColor,
          border: style.borderBottomWidth,
          shadow: style.boxShadow,
          hasTeams: !!top.querySelector(".faceoff"),
          buttonTop: Math.round(
            button.getBoundingClientRect().top - top.getBoundingClientRect().top,
          ),
        };
      }),
    );

    expect(sheets.map((sheet) => sheet.id)).toEqual(["gameSheet", "teamSheet", "playerSheet"]);
    for (const sheet of sheets)
      expect(sheet, sheet.id).toEqual({
        id: sheet.id,
        sheet: card,
        band: floor,
        border: "0px",
        shadow: `${line} 0px -1px 0px 0px inset`,
        hasTeams: sheet.id === "gameSheet",
        buttonTop: BUTTON_TOP_PX,
      });
  });

  for (const theme of THEMES)
    test(`in ${theme}, every sheet and its roster's pinned cells are the card's color, and settings stay the page's own`, async ({
      page,
    }) => {
      await openApp(page);
      await page.evaluate((name) => (document.documentElement.dataset.theme = name), theme);
      const { teamSheet } = await openFeverFromGame(page);
      await teamSheet.getByRole("tab", { name: "Roster" }).click();
      const roster = page.locator("#rosterSection");
      await roster.getByRole("button", { name: "Aliyah Boston" }).click();
      await expect(page.locator("#playerSheet .player-facts")).toBeVisible();
      const floor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const card = await readTokenColor(page, "--card");

      const sheetColors = await page
        .locator(".sheet-page")
        .evaluateAll((sheets) => sheets.map((sheet) => getComputedStyle(sheet).backgroundColor));
      const pinnedColors = await roster
        .locator("table.roster :is(thead, .roster-player)")
        .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).backgroundColor));
      expect(sheetColors).toEqual([card, card, card]);
      expect(new Set(pinnedColors)).toEqual(new Set([card]));

      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.locator(".settings-panel")).toHaveCSS("background-color", floor);
      await expect(page.locator(".settings-panel .sheet-top")).toHaveCSS("background-color", floor);
      await expect(page.locator(".settings-panel .sheet-top")).toHaveCSS("box-shadow", "none");
    });

  test("on a wide screen, a sheet and settings lift off the page by a shadow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openApp(page);
    await openGame(page);
    await expect(page.locator("#sheetDialog")).not.toHaveCSS("box-shadow", "none");

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator(".settings-panel")).not.toHaveCSS("box-shadow", "none");
  });

  test("on a phone, every sheet fills the screen, whatever it holds", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    const { gameSheet, teamSheet } = await openFeverFromGame(page);
    const dialog = page.locator("#sheetDialog");

    expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, ...PHONE });
    const readHeight = (locator) => locator.evaluate((element) => element.offsetHeight);
    expect(await readHeight(teamSheet)).toBe(PHONE.height);
    expect(await readHeight(gameSheet)).toBe(PHONE.height);
  });

  test("on a phone, sheets have square corners and no shadow, nothing dims the page or the sheet a sheet slides in over, and the row of sheets never scrolls", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    const { gameSheet, teamSheet } = await openFeverFromGame(page);
    const dialog = page.locator("#sheetDialog");

    await expect(dialog).toHaveCSS("border-top-left-radius", "0px");
    await expect(dialog).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(
      await dialog.evaluate((element) => getComputedStyle(element, "::backdrop").backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    await expect(dialog.locator(".sheet-row")).toHaveCSS("overflow-x", "hidden");
    for (const sheet of [gameSheet, teamSheet]) {
      await expect(sheet).toHaveCSS("border-top-left-radius", "0px");
      await expect(sheet).toHaveCSS("box-shadow", "none");
      await expect(sheet).toHaveCSS("filter", "none");
    }
  });

  test("at rest, only the sheet on top and its shown section are drawn, and neither sheets nor sections scroll sideways, which an iPhone can leave undrawn", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    const { gameSheet, teamSheet } = await openFeverFromGame(page);

    await expect(gameSheet).toHaveCSS("visibility", "hidden");
    await expect(teamSheet).toHaveCSS("visibility", "visible");
    await expect(page.locator("#teamSection")).toHaveCSS("visibility", "visible");
    await expect(page.locator("#rosterSection")).toHaveCSS("visibility", "hidden");
    await expect(teamSheet.locator(".sheet-sections")).toHaveCSS("overflow-x", "hidden");

    await teamSheet.getByRole("tab", { name: "Roster" }).click();
    await expectShown(page.locator("#rosterSection"));
    await expect(page.locator("#teamSection")).toHaveCSS("visibility", "hidden");
  });

  test("on a phone, a swipe right goes back to the game and takes the team's sheet away, so a swipe left leaves the game where it is, and a swipe down closes it", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    const { gameSheet, teamSheet } = await openFeverFromGame(page);

    await (
      await drag(page, { x: 60, y: 400 }, { x: 250 })
    )();
    await expectShown(gameSheet);
    await expect(teamSheet).toBeHidden();

    await (
      await drag(page, { x: 330, y: 400 }, { x: -250 })
    )();
    await expectShown(gameSheet);
    await expect(teamSheet).toBeHidden();

    await (
      await drag(page, { x: 200, y: 120 }, { y: 300 })
    )();
    await expect(page.locator("#sheetDialog")).toBeHidden();
  });

  test("on a phone, a short swipe right springs back to the team once the finger lifts", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    const { teamSheet } = await openFeverFromGame(page);

    const release = await drag(page, { x: 60, y: 400 }, { x: 46 }, { durationMs: 1000 });
    expect(await readLeft(teamSheet)).toBeGreaterThan(30);
    await release();

    await expectShown(teamSheet);
  });

  test("a tap on a team in a game's sheet, opened from another team's, brings that team's sheet in beside the game's, and back goes to the game, then to the first team where it was", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    await page
      .getByRole("button", { name: /Aces\b.*team details$/ })
      .first()
      .click();
    const teamSection = page.locator("#teamSection");
    await teamSection.evaluate((section) => (section.scrollTop = 30));
    await page
      .locator("#teamSheet")
      .getByRole("button", { name: /^Yesterday\b.*game details$/ })
      .click();
    const gameSheet = page.locator("#gameSheet");
    await expectShown(gameSheet);

    await page.locator(FEVER_IN_GAME).click();

    const teamSheet = page.locator("#teamSheet");
    await expect(teamSheet.locator("#teamTitle")).toHaveText("Indiana Fever");
    await expectShown(teamSheet);
    expect(await readLeft(gameSheet)).toBeCloseTo(-(PHONE.width + GAP_PX), 0);
    const copy = page.locator("#sheetDialog .sheet-page:not([id])");
    await expect(copy.locator(".team-title")).toHaveText("Las Vegas Aces");
    await expect(copy.locator("[id], [data-last-drawn]")).toHaveCount(0);
    expect(await readLeft(copy)).toBeCloseTo(-(PHONE.width + GAP_PX), 0);

    await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
    await expectShown(gameSheet);
    await gameSheet.getByRole("button", { name: "Back to Team", exact: true }).click();

    await expectShown(teamSheet);
    await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
    await expect(copy).toHaveCount(0);
    await expect(gameSheet).toBeHidden();
    expect(await teamSection.evaluate((section) => section.scrollTop)).toBe(30);
  });

  test("a tap on the team a game's sheet was opened from goes back to its sheet", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    const { teamSheet, gameSheet } = await openFeverFromAcesGame(page);

    await gameSheet
      .locator(".faceoff")
      .getByRole("button", { name: /Aces\b.*team details$/ })
      .click();

    await expectShown(teamSheet);
    await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
    await expect(gameSheet).toBeHidden();
    await expect(page.locator("#sheetDialog .sheet-page")).toHaveCount(3);
  });
});

test("a team's sheet slides in from the right beside the game's, which waits a gap past the left edge, and slides away again on the back button, a frame at a time, leaving the row once it's gone", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const { gameSheet, teamSheet } = await openFeverFromGame(page);
  expect(await readLeft(gameSheet)).toBeCloseTo(-(PHONE.width + GAP_PX), 0);

  const readLefts = await startTrackingLeft(page, { id: "teamSheet" });
  await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
  await expectShown(gameSheet);
  await expect(teamSheet).toBeHidden();
  const lefts = await readLefts();
  expect(hasStopOnTheWay(lefts)).toBe(true);
  expect(isMonotonic(lefts)).toBe(true);
  expect(lefts.at(-1)).toBeGreaterThan(lefts[0]);
});

test("a team's sheet opened from a game's opened from another team's slides in from the right a frame at a time, and back to the first team slides it in from the left with nothing moving once it's there", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const { teamSheet, gameSheet } = await openFeverFromAcesGame(page);

  const readFeverLefts = await startTrackingLeft(page, { id: "teamSheet", tap: FEVER_IN_GAME });
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Indiana Fever");
  await expectShown(teamSheet);
  const feverLefts = await readFeverLefts();
  expect(hasStopOnTheWay(feverLefts)).toBe(true);
  expect(isMonotonic(feverLefts)).toBe(true);
  expect(feverLefts[0]).toBeGreaterThan(feverLefts.at(-1) ?? 0);

  await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
  await expectShown(gameSheet);
  const readAcesLefts = await startTrackingLeft(page, { title: "Las Vegas Aces" });
  await gameSheet.getByRole("button", { name: "Back to Team", exact: true }).click();
  await expectShown(teamSheet);
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
  await waitForTimedAnimations(page);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const acesLefts = await readAcesLefts();
  expect(hasStopOnTheWay(acesLefts)).toBe(true);
  expect(isMonotonic(acesLefts)).toBe(true);
  expect(acesLefts[0]).toBeLessThan(0);
  expect(acesLefts.at(-1)).toBe(0);
});

test("on a phone, a finger moving a player's sheet brings the game's in from under it, the page changing nothing but where the sheets are, and the sheets settle without stepping back or running an opening motion", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const readMotions = await recordSheetMotions(page);
  await openApp(page);
  const gameSheet = await openGame(page);
  await gameSheet.locator(".players .player-open").first().click();
  await expectShown(page.locator("#playerSheet"));
  await readMotions();
  await page.evaluate(() => {
    const changes = /** @type {string[]} */ ([]);
    const isMoving = (/** @type {MutationRecord} */ record) =>
      record.attributeName === "style" ||
      record.attributeName === "data-sliding" ||
      (record.attributeName === "class" &&
        /** @type {Element} */ (record.target).matches(".sheet-row"));
    new MutationObserver((records) =>
      changes.push(
        ...records
          .filter((record) => !isMoving(record))
          .map((record) => record.attributeName ?? ""),
      ),
    ).observe(/** @type {Node} */ (document.getElementById("sheetDialog")), {
      attributes: true,
      subtree: true,
    });
    Object.assign(window, { sheetChanges: changes });
  });

  const release = await drag(page, { x: 60, y: 400 }, { x: 250 });
  const { playerLeft, gameLeft } = await readRestingLefts(page);
  expect(playerLeft).toBeGreaterThan(PHONE.width / 2);
  expect(gameLeft).toBeCloseTo(playerLeft - PHONE.width - GAP_PX, 0);
  expect(await page.evaluate(() => /** @type {any} */ (window).sheetChanges)).toEqual([]);

  const readLefts = await startTrackingLeft(page, { id: "playerSheet" });
  await release();
  await expectShown(gameSheet);
  await expect(page.locator("#playerSheet")).toBeHidden();
  const lefts = await readLefts();

  expect(isMonotonic(lefts)).toBe(true);
  expect(lefts.at(-1)).toBeGreaterThan(lefts[0]);
  expect((await readMotions()).filter(({ id }) => id === "sheetDialog")).toEqual([]);
});

test("on a phone, while a finger moves a player's sheet, the game's stays a gap away on every frame, the sheets' color between them, each band edged on its sides in its line until they rest", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const gameSheet = await openGame(page);
  await gameSheet.locator(".players .player-open").first().click();
  const playerSheet = page.locator("#playerSheet");
  await expectShown(playerSheet);
  const row = page.locator("#sheetDialog .sheet-row");
  const [card, line] = await Promise.all(
    ["--card", "--edge"].map((token) => readTokenColor(page, token)),
  );
  await expect(row).toHaveCSS("background-color", card);
  await page.evaluate(() => {
    const read = (/** @type {string} */ id) =>
      /** @type {Element} */ (document.getElementById(id)).getBoundingClientRect();
    const gaps = /** @type {number[]} */ ([]);
    const note = () => {
      const [game, player] = [read("gameSheet"), read("playerSheet")];
      if (player.left > 0) gaps.push(Math.round(player.left - game.right));
      if (!(/** @type {any} */ (window).isTrackingDone)) requestAnimationFrame(note);
    };
    Object.assign(window, { trackedGaps: gaps, isTrackingDone: false });
    requestAnimationFrame(note);
  });
  const readBandShadow = () =>
    playerSheet.locator(".sheet-top").evaluate((top) => getComputedStyle(top).boxShadow);

  const release = await drag(page, { x: 60, y: 400 }, { x: 160 }, { durationMs: 600 });
  await expect(row).toHaveAttribute("data-sliding", "finger");
  await expect(row).toHaveCSS("background-image", "none");
  expect(await readBandShadow()).toBe(
    `${line} 0px -1px 0px 0px inset, ${line} 1px 0px 0px 0px inset, ${line} -1px 0px 0px 0px inset`,
  );
  await release();
  await expectShown(gameSheet);
  const gaps = await page.evaluate(() => {
    Object.assign(window, { isTrackingDone: true });
    return /** @type {number[]} */ (/** @type {any} */ (window).trackedGaps);
  });

  expect(gaps.length).toBeGreaterThan(2);
  expect(new Set(gaps)).toEqual(new Set([GAP_PX]));
  await expect(row).not.toHaveAttribute("data-sliding");
  await expect(gameSheet.locator(".sheet-top")).toHaveCSS(
    "box-shadow",
    `${line} 0px -1px 0px 0px inset`,
  );
});

test("on a phone, a tap on back slides the two sheets as one, the gap taking the band's color down to where the shorter band ends, with no line down the bands' sides", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const gameSheet = await openGame(page);
  // A click scrolls the player's name into view first, which, once the box score has loaded,
  // scrolls the game's band off its sheet and leaves no band to join.
  await gameSheet.locator(".players .player-open").first().dispatchEvent("click");
  const playerSheet = page.locator("#playerSheet");
  await expectShown(playerSheet);
  const line = await readTokenColor(page, "--edge");
  const sharedBand = await page.evaluate(() => {
    const row = /** @type {Element} */ (document.querySelector("#sheetDialog .sheet-row"));
    const readBottom = (/** @type {string} */ id) =>
      /** @type {Element} */ (document.querySelector(`#${id} .sheet-top`)).getBoundingClientRect()
        .bottom - row.getBoundingClientRect().top;
    return Math.min(readBottom("gameSheet"), readBottom("playerSheet"));
  });
  await page.evaluate(() => {
    const row = /** @type {Element} */ (document.querySelector("#sheetDialog .sheet-row"));
    const top = /** @type {Element} */ (document.querySelector("#playerSheet .sheet-top"));
    const frames = /** @type {object[]} */ ([]);
    const note = () => {
      const style = getComputedStyle(row);
      if (row.getAttribute("data-sliding"))
        frames.push({
          sliding: row.getAttribute("data-sliding"),
          joined: parseFloat(style.getPropertyValue("--sheet-band-joined")),
          isFilled: style.backgroundImage.startsWith("linear-gradient"),
          sides: getComputedStyle(top).boxShadow,
        });
      if (!(/** @type {any} */ (window).isTrackingDone)) requestAnimationFrame(note);
    };
    Object.assign(window, { trackedFrames: frames, isTrackingDone: false });
    requestAnimationFrame(note);
  });

  await playerSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
  await expectShown(gameSheet);
  const frames = await page.evaluate(() => {
    Object.assign(window, { isTrackingDone: true });
    return /** @type {any[]} */ (/** @type {any} */ (window).trackedFrames);
  });

  expect(frames.length).toBeGreaterThan(2);
  for (const frame of frames)
    expect(frame).toEqual({
      sliding: "tap",
      joined: expect.closeTo(sharedBand, 0),
      isFilled: true,
      sides: `${line} 0px -1px 0px 0px inset`,
    });
  await expect(page.locator("#sheetDialog .sheet-row")).toHaveCSS("background-image", "none");
});
