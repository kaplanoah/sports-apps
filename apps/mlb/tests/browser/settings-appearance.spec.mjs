import { test, expect, openApp, openSettings, serveLockedApp } from "./harness.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { IPHONE, IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";
import { openFromHomeScreen } from "../../../../tests/browser/touch.mjs";
import {
  checkFailedPickPutBack,
  checkNewCurrentSeasonListed,
  checkPickKeptThroughRedraw,
  checkSeasonsOnFailedList,
  checkSettingsOnReload,
} from "../../../../tests/browser/settings-reload.mjs";
import { WITH_A_PAST_SEASON } from "./settings-sheet.mjs";
import {
  checkHandoffRenewal,
  checkIconKeptOnlyOnOpen,
  checkNoteWithoutIcon,
  checkReAddHandoff,
  checkReAddNote,
  checkReAddNoteDismissal,
  checkReAddNoteEases,
  checkReAddNoteOnReload,
  checkSystemInstallIcon,
} from "../../../../tests/browser/re-add-note.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const readBackground = (page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const BALL = "rgb(245, 241, 230)";
const NIGHT_GAME = "rgb(13, 31, 22)";

/**
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} theme
 */
async function expectTheme(page, theme) {
  const isDark = theme === "dark";
  await expect.poll(() => readBackground(page)).toBe(isDark ? NIGHT_GAME : BALL);
  await expect(page.locator("#homeScreenIcon")).toHaveAttribute(
    "href",
    isDark ? "icon-180.png" : "icon-light-180.png",
  );
  await expect(page.locator("#tabIcon")).toHaveAttribute(
    "href",
    isDark ? "icon.svg" : "icon-light.svg",
  );
  await expect(page.locator("#themeColor")).toHaveAttribute(
    "content",
    isDark ? "#0d1f16" : "#f5f1e6",
  );
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} choice
 */
async function chooseAppearance(page, choice) {
  await openSettings(page);
  await page
    .getByRole("radiogroup", { name: "Appearance" })
    .getByRole("radio", { name: choice, exact: true })
    .check();
  await page.keyboard.press("Escape");
}

test("on System, the page and its icons follow the phone's dark or light setting", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  await expect(page.locator('input[name="appearance"][value="auto"]')).toBeChecked();
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
});

test("choosing Night Game or Ball overrides the phone, and the choice stays after a reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await chooseAppearance(page, "Night Game");
  await expectTheme(page, "dark");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expectTheme(page, "dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await chooseAppearance(page, "Ball");
  await expectTheme(page, "light");
  await chooseAppearance(page, "System");
  await expectTheme(page, "dark");
});

test("a look chosen in another tab shows in this one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await expectTheme(page, "light");

  await keepInOtherTab(page, "appearance", "dark");

  await expectTheme(page, "dark");
  await openSettings(page);
  await expect(page.getByRole("radio", { name: "Night Game" })).toBeChecked();
});

test.describe("in an iPhone's Home Screen app", () => {
  test.use({ userAgent: IPHONE_AGENT });
  const looks = { light: "Ball", dark: "Night Game" };

  test("while the look picked, or on System the phone's, isn't the icon's, settings shows both icons and how to update it, linking to Safari on the choice picked, which the browser and Android leave out", async ({
    page,
    context,
    browser,
  }) => {
    await checkReAddNote({ page, context, browser, openApp, openSettings, looks });
  });

  test("the icon note's X takes it away for good in that install", async ({ page }) => {
    await checkReAddNoteDismissal({ page, openApp, openSettings, looks });
  });

  test("a reload with settings open on the icon note shows the note before the page's code arrives", async ({
    page,
  }) => {
    await checkReAddNoteOnReload({ page, openApp, openSettings, looks });
  });

  test("a reload keeps no icon for an app that has none yet, rather than the phone's setting, and settings says nothing of it until the viewer switches looks", async ({
    page,
  }) => {
    await checkIconKeptOnlyOnOpen({ page, openApp, openSettings, looks });
  });

  test("an app that doesn't know its icon shows the note from the first switch of looks, System too, until the X", async ({
    page,
  }) => {
    await checkNoteWithoutIcon({ page, openApp, openSettings, looks });
  });

  test("an app added on System has the icon the phone's setting showed as it first opened", async ({
    page,
  }) => {
    await checkSystemInstallIcon({ page, openApp, openSettings, looks });
  });

  test("the icon note grows in as a pick sets the icon off and shrinks away as its opening played backward", async ({
    page,
  }) => {
    await checkReAddNoteEases({ page, openApp, openSettings, looks });
  });

  test("behind an access code, the link signs Safari in, so it opens the welcome on the theme picked without asking for the code", async ({
    page,
    browser,
  }) => {
    await checkReAddHandoff({ page, browser, serveLockedApp, openSettings, looks });
  });

  test("the link's handoff renews halfway through and on coming back once that's due, tries again after a failure, stops once settings closes or the icon's look is picked, and starts again as settings opens on the note", async ({
    page,
  }) => {
    await checkHandoffRenewal({ page, serveLockedApp, openSettings, looks });
  });
});

test("a reload with settings open shows its seasons, switches, and look picked before the page's code arrives", async ({
  page,
}) => {
  await openApp(page, WITH_A_PAST_SEASON);
  await checkSettingsOnReload({
    page,
    look: "Night Game",
    switchName: "Include content from The Athletic",
    pastSeason: "2025",
    currentSeason: "2026",
  });
});

test("a season picked while its record is on its way stays picked as the picker is drawn again meanwhile", async ({
  page,
}) => {
  const app = await openApp(page, WITH_A_PAST_SEASON);
  await checkPickKeptThroughRedraw({
    page,
    pastSeason: "2025",
    newSeason: 2027,
    moveCurrentTo: (year) => app.writeFromWorker("live/current", { season: year }),
  });
});

test("a past season picked whose record can't be read puts the Season picker back on the season shown, says so, and can be picked again", async ({
  page,
}) => {
  await openApp(page, WITH_A_PAST_SEASON);
  await checkFailedPickPutBack({ page, pastSeason: "2025", currentSeason: "2026" });
});

test("while the store can't list its seasons, a new current season joins the Season picker, with the past season shown still chosen", async ({
  page,
}) => {
  const app = await openApp(page, WITH_A_PAST_SEASON);
  await checkNewCurrentSeasonListed({
    page,
    pastSeason: "2025",
    newSeason: 2027,
    moveCurrentTo: (year) => app.writeFromWorker("live/current", { season: year }),
    seasons: ["2027", "2026", "2025"],
  });
});

test("a reload with settings open while the store can't list its seasons lists the ones it listed, with the season shown chosen", async ({
  page,
}) => {
  await openApp(page, WITH_A_PAST_SEASON);
  await checkSeasonsOnFailedList({ page, seasons: ["2026", "2025"], shown: "2026" });
});

test("Appearance sits under Notifications, above the News switches, each choice showing the icon it offers", async ({
  page,
}) => {
  await openApp(page);
  await openSettings(page);
  const appearance = page.locator(`${SETTINGS} .appearance-row`);
  const news = page.getByRole("group", { name: "News" });
  const [appearanceBox, newsBox] = await Promise.all([
    appearance.boundingBox(),
    news.boundingBox(),
  ]);
  expect(appearanceBox.y + appearanceBox.height).toBeLessThanOrEqual(newsBox.y);
  await expect(appearance.locator(".appearance-choice")).toHaveText([
    "System",
    "Ball",
    "Night Game",
  ]);
  for (const icon of await appearance.locator(".appearance-icon").all())
    expect(await icon.boundingBox()).toMatchObject({ width: 60, height: 60 });
});

test.describe("on an iPhone's Home Screen app, which has no Home Screen box", () => {
  test.use(IPHONE);

  test.beforeEach(async ({ page }) => {
    await openFromHomeScreen(page);
    await openApp(page);
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toBeHidden();
  });

  test("a line ends the settings above News and the News switches, over the ranking, and none sits under News's label or between its switches, each switch's row right under the one before", async ({
    page,
  }) => {
    const settingsAbove = page.locator(`${SETTINGS} .settings-main > .settings-controls`);
    expect(
      await settingsAbove.evaluate((controls) => getComputedStyle(controls).borderBottomStyle),
    ).toBe("solid");
    const news = page.getByRole("group", { name: "News" });
    const newsLines = await news.evaluate((group) =>
      [group, ...group.children, ...group.querySelectorAll(".control-row")].flatMap((part) => {
        const style = getComputedStyle(part);
        return ["Top", "Bottom"]
          .filter((side) => style[`border${side}Style`] !== "none")
          .map((side) => `${part.className} ${side}`);
      }),
    );
    expect(newsLines).toEqual(["settings-group-rows Bottom"]);
    const lineToRanking = await news.evaluate((group) => {
      const rows = group.querySelector(".settings-group-rows").getBoundingClientRect();
      const lastRow = [...group.querySelectorAll(".control-row")].at(-1).getBoundingClientRect();
      const ranking = document.getElementById("rankingTitle").getBoundingClientRect();
      return { underLastRow: rows.bottom - lastRow.bottom, overRanking: ranking.top - rows.bottom };
    });
    expect(lineToRanking.underLastRow).toBe(1);
    expect(lineToRanking.overRanking).toBeGreaterThan(0);
    const rowEdges = await news.locator(".control-row").evaluateAll((rows) =>
      rows.map((row) => {
        const box = row.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }),
    );
    const gaps = rowEdges.slice(1).map((row, index) => row.top - rowEdges[index].bottom);
    expect(gaps).toEqual([0, 0]);
  });

  test("the first setting sits 38px under the settings title", async ({ page }) => {
    const [title, controls] = await Promise.all(
      ["#settingsTitle", `${SETTINGS} .settings-main > .settings-controls`].map((selector) =>
        page.locator(selector).evaluate((part) => part.getBoundingClientRect().toJSON()),
      ),
    );
    expect(Math.round(controls.top - title.bottom)).toBe(38);
  });
});
