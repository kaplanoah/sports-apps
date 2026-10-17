import {
  test,
  expect,
  openApp,
  buildFixtureSnapshot,
  BOX_SCORES,
  BROADCASTS_FIXTURE,
  PLAYER_DOCS,
  ROSTER_DOCS,
} from "./harness.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { readTopSpacing } from "../../../../tests/browser/sheet-top.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PHONE = { width: 390, height: 844 };
const WIDE_SCREEN = { width: 1280, height: 844 };
// How far under a band's top every sheet's close or back button sits.
const BUTTON_TOP_PX = 8;

/**
 * Opens the Dodgers at the Braves' sheet, then the Dodgers' beside it.
 * @param {import("@playwright/test").Page} page
 */
async function openDodgersFromGame(page) {
  await openApp(page, {
    now: BROADCASTS_FIXTURE.now,
    snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE) },
    boxScores: BOX_SCORES,
    store: { ...ROSTER_DOCS, ...PLAYER_DOCS },
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page
    .locator("#seasonGames")
    .getByRole("button", { name: /^Game details: Dodgers at Braves, Tue, Oct 6/ })
    .click();
  const gameSheet = page.locator("#gameSheet");
  await expectShown(gameSheet);
  await gameSheet
    .locator("#gameBody .game-row")
    .getByRole("button", { name: "Team details: Dodgers" })
    .click();
  const teamSheet = page.locator("#teamSheet");
  await expect(teamSheet.locator("#teamTitle")).toContainText("Dodgers");
  await expectShown(teamSheet);
  return { gameSheet, teamSheet };
}

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

test("every sheet's top is a band in the band's color, ending in its line and edged on no other side at rest, with its title and its close or back button each in one spot, whatever goes under the title", async ({
  page,
}) => {
  const { teamSheet } = await openDodgersFromGame(page);
  await teamSheet.getByRole("tab", { name: "Roster" }).click();
  await teamSheet.locator("#rosterBody").getByRole("button", { name: "Mookie Betts" }).click();
  await expectShown(page.locator("#playerSheet"));
  const [band, line] = await Promise.all(
    ["--sheet-band", "--sheet-band-line"].map((token) => readTokenColor(page, token)),
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
      const title = /** @type {Element} */ (top.querySelector(".sheet-head h2"));
      const readTop = (/** @type {Element} */ element) =>
        element.getBoundingClientRect().top - top.getBoundingClientRect().top;
      return {
        id: sheet.id,
        band: style.backgroundColor,
        border: style.borderBottomWidth,
        shadow: style.boxShadow,
        titleTop: readTop(title),
        buttonTop: Math.round(readTop(button)),
      };
    }),
  );

  expect(sheets.map((sheet) => sheet.id)).toEqual(["gameSheet", "teamSheet", "playerSheet"]);
  await expect(page.locator("#playerPlace")).toHaveText("Nashville, TN");
  for (const sheet of sheets)
    expect(sheet, sheet.id).toEqual({
      id: sheet.id,
      band,
      border: "0px",
      shadow: `${line} 0px -1px 0px 0px inset`,
      titleTop: sheets[0].titleTop,
      buttonTop: BUTTON_TOP_PX,
    });
});

test("a title that runs to more lines leaves its close or back button where it was", async ({
  page,
}) => {
  const { teamSheet } = await openDodgersFromGame(page);
  const back = teamSheet.locator(".sheet-back");
  const readButtonTop = () => back.evaluate((button) => button.getBoundingClientRect().top);
  const before = await readButtonTop();

  await teamSheet.locator(".sheet-title").evaluate((title) => {
    const line = title.appendChild(document.createElement("p"));
    line.className = "sheet-note";
    line.textContent = "A line more under the title";
  });

  expect(await readButtonTop()).toBe(before);
});

test("a sheet's top holds its title, its close or back button, and the room under its last line alike on a phone and a wide screen", async ({
  page,
}) => {
  const top = page.locator("#teamSheet .sheet-top");
  await page.setViewportSize(PHONE);
  await openDodgersFromGame(page);
  const onPhone = await readTopSpacing(top);

  await page.setViewportSize(WIDE_SCREEN);

  expect(await readTopSpacing(top)).toEqual(onPhone);
});

test("on a phone, every sheet fills the screen, whatever it holds", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { gameSheet, teamSheet } = await openDodgersFromGame(page);

  expect(await page.locator("#sheetDialog").boundingBox()).toEqual({ x: 0, y: 0, ...PHONE });
  const readHeight = (locator) => locator.evaluate((element) => element.offsetHeight);
  expect(await readHeight(teamSheet)).toBe(PHONE.height);
  expect(await readHeight(gameSheet)).toBe(PHONE.height);
});

test("on a phone, sheets have square corners and no shadow, nothing dims the page or the sheet a sheet slides in over, and the row of sheets never scrolls", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const { gameSheet, teamSheet } = await openDodgersFromGame(page);
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
