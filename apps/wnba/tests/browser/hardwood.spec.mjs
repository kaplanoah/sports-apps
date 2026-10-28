import { test, expect, openApp } from "./harness.mjs";
import { readPillNames } from "../../../../tests/browser/pill-names.mjs";
import { readCapitals } from "../../../../tests/browser/capitals.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { scrollSeasonPartToEnd } from "../../../../tests/browser/season-scroll.mjs";
import { readRole } from "../../../../tests/browser/type-roles.mjs";
import { readTokenColor } from "./theme.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";
import { THEMES } from "../../../../tests/browser/theme-layout.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PHONE = { width: 390, height: 844 };

/**
 * The colors a chip of each class draws with, set loose on the page.
 * @param {import("@playwright/test").Page} page
 * @param {string} className
 */
const readChip = (page, className) =>
  page.evaluate((name) => {
    const chip = document.createElement("span");
    chip.className = name;
    chip.textContent = "Bonus";
    document.body.append(chip);
    const { color, borderTopColor, borderTopWidth, backgroundColor } = getComputedStyle(chip);
    chip.remove();
    return { color, borderTopColor, borderTopWidth, backgroundColor };
  }, className);

for (const colorScheme of THEMES) {
  test(`each chip takes the color of its job, in ${colorScheme}: what's happening now outlined in orange, a champion in teal, and a conference in ink`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openApp(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    const [now, result, ink] = await Promise.all(
      ["--orange", "--teal", "--ink-mid"].map((token) => readTokenColor(page, token)),
    );

    for (const className of ["chip outlined bonus", "chip outlined foul-chip"]) {
      expect(await readChip(page, className), className).toEqual({
        color: now,
        borderTopColor: now,
        borderTopWidth: "1px",
        backgroundColor: "rgba(0, 0, 0, 0)",
      });
    }
    expect((await readChip(page, "chip filled status-chip champion")).backgroundColor).toBe(result);
    expect((await readChip(page, "chip outlined conference-tag")).color).toBe(ink);
  });
}

for (const colorScheme of THEMES) {
  test(`the Updates box and settings' icon note are cards raised inside an edge, in ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openApp(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    const [raised, edge] = await Promise.all(
      ["--raised", "--edge"].map((token) => readTokenColor(page, token)),
    );
    for (const box of ["#updates", "#appearanceNote"]) {
      await expect(page.locator(box)).toHaveCSS("background-color", raised);
      await expect(page.locator(box)).toHaveCSS("border-top-color", edge);
    }
  });
}

test("a Read button is raised like a card, a button's height, its words a button's, centered on their capitals", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.writeDocument("news/cards", {
    cards: [
      {
        lead: {
          id: "report",
          url: "https://example.com/report",
          title: "A report on the Dream's approach against the Liberty",
          summary: "What happened, in a sentence or two.",
          author: "A Writer",
          outlet: "The IX",
          source: "ix",
          publishedAt: "2026-09-30T14:00:00.000Z",
          teams: ["NYL", "ATL"],
        },
        more: [],
      },
    ],
  });
  await page.getByRole("tab", { name: "News" }).click();
  const button = page.locator(".read-button").first();
  await expect(button).toBeVisible();

  const look = await button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const card = getComputedStyle(/** @type {Element} */ (element.closest(".news-card")));
    const style = getComputedStyle(element);
    return {
      height: box.height,
      middle: (box.top + box.bottom) / 2,
      size: style.fontSize,
      weight: style.fontWeight,
      background: style.backgroundColor,
      cardBackground: card.backgroundColor,
    };
  });
  const setting = await readRole(page, "setting");
  expect(look.height).toBe(36);
  expect(look.size).toBe(`${setting.size}px`);
  expect(look.weight).toBe(String(setting.weight));
  expect(look.background).toBe(look.cardBackground);
  const capitals = await readCapitals(button.locator(".read-label"));
  expect(capitals.middle - look.middle).toBeCloseTo(0, 0);
});

test("a pill's names are buttons, in sentence case in a button's words and height, centered on their capitals, the pill 10px under the header and 9px over what it shows, and its bar ends in a line, not a fade, once what it shows scrolls under it", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const name = page.locator("#bracketStandingsPill .pager-tabs button").first();
  const setting = await readRole(page, "setting");
  await expect(name).toHaveCSS("text-transform", "none");
  await expect(name).toHaveCSS("font-size", `${setting.size}px`);
  await expect(name).toHaveCSS("font-weight", String(setting.weight));
  await expect(name).toHaveCSS("height", "36px");
  const box = /** @type {{ y: number, height: number }} */ (await name.boundingBox());
  expect((await readCapitals(name)).middle - (box.y + box.height / 2)).toBeCloseTo(0, 0);
  const room = await page.evaluate(() => {
    const readBox = (/** @type {string} */ selector) =>
      /** @type {Element} */ (document.querySelector(selector)).getBoundingClientRect();
    const header = readBox("header.top");
    const pill = readBox("#bracketStandingsPill .pager-tabs");
    const standings = readBox("#standingsWrap");
    return {
      above: pill.top - header.bottom,
      height: pill.height,
      below: standings.top - pill.bottom,
    };
  });
  expect(room).toEqual({ above: 10, height: 36, below: 9 });

  await scrollSeasonPartToEnd(page, "standings");
  const bar = page.locator("#bracketStandingsPill");
  const divider = await readTokenColor(page, "--divider");
  await expect(bar).toHaveCSS("box-shadow", `${divider} 0px 1px 0px 0px`);
  await expect(bar).toHaveCSS("background-image", "none");
});

/**
 * A color as red, green, and blue, however the page computes it.
 * @param {import("@playwright/test").Page} page
 * @param {string} color
 */
const readChannels = (page, color) =>
  page.evaluate((value) => {
    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d")
    );
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, color);

for (const colorScheme of THEMES) {
  test(`the list a pill shows is filled orange, its name in the color on orange, and the other names are in ink, in ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const chosen = page.locator("#bracketStandingsPill .pager-tabs button.active");
    await expect(chosen).toHaveText("Standings");
    const [orange, onOrange, ink] = await Promise.all(
      ["--orange", "--orange-ink", "--ink"].map(async (token) =>
        readChannels(page, await readTokenColor(page, token)),
      ),
    );
    const names = await readPillNames(page.locator("#bracketStandingsPill [role=tablist]"));
    const standings = names.find((each) => each.name === "Standings");
    expect(await readChannels(page, standings.fill)).toEqual(orange);
    expect(await readChannels(page, standings.textColor)).toEqual(onOrange);
    for (const other of names.filter((each) => each !== standings)) {
      expect(other.fill, other.name).toBe("rgba(0, 0, 0, 0)");
      expect(await readChannels(page, other.textColor), other.name).toEqual(ink);
    }
    await expect(page.locator("#bracketStandingsPill .pager-tabs button:not(.active)")).toHaveCSS(
      "font-weight",
      String((await readRole(page, "setting")).weight),
    );
  });

  test(`the day at the top of the Games list is filled orange inside the darker edge, today's date is orange, the month teal, a date without games as dim as a weekday and a step lighter, and Today orange, in ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openApp(page, { isWholeSeason: true });
    await page.getByRole("tab", { name: "Games" }).click();
    const chosen = page.locator("#seasonGames .day-cell.is-chosen");
    await expect(chosen).toHaveAttribute("data-day", "2026-09-30");
    const [orange, onOrange, teal, inkDim, edge] = await Promise.all(
      ["--orange", "--orange-ink", "--teal", "--ink-dim", "--pager-chosen-edge"].map(
        async (token) => readChannels(page, await readTokenColor(page, token)),
      ),
    );
    const readColor = (/** @type {import("@playwright/test").Locator} */ locator, property) =>
      locator.evaluate((element, name) => getComputedStyle(element)[name], property);
    expect(await readChannels(page, await readColor(chosen, "backgroundColor"))).toEqual(orange);
    const chosenEdge = await readColor(chosen, "boxShadow");
    expect(await readChannels(page, chosenEdge.replace(/\) .*$/, ")"))).toEqual(edge);
    const chosenNumber = chosen.locator(".cell-number");
    expect(await readChannels(page, await readColor(chosenNumber, "color"))).toEqual(onOrange);

    await page.locator('#seasonGames .day-cell[data-day="2026-09-27"]').click();
    await expect(chosen).toHaveAttribute("data-day", "2026-09-27");
    const today = page.locator("#seasonGames .day-cell.is-today .cell-number");
    expect(await readChannels(page, await readColor(today, "color"))).toEqual(orange);
    const besideGames = page.locator("#seasonGames .game-day.is-today .day-number");
    expect(await readChannels(page, await readColor(besideGames, "color"))).toEqual(orange);
    const month = page.locator("#seasonGames .strip-month");
    await expect(month).toHaveText("September");
    expect(await readChannels(page, await readColor(month, "color"))).toEqual(teal);
    const weekday = page.locator('#seasonGames .day-cell[data-day="2026-09-29"] .cell-name');
    expect(await readChannels(page, await readColor(weekday, "color"))).toEqual(inkDim);
    const quietNumber = page.locator('#seasonGames .day-cell[data-day="2026-09-28"] .cell-number');
    expect(await readChannels(page, await readColor(quietNumber, "color"))).toEqual(inkDim);
    const body = await readRole(page, "body");
    await expect(quietNumber).toHaveCSS("font-weight", String(body.weight + 100));
    const gameNumber = page.locator('#seasonGames .day-cell[data-day="2026-09-29"] .cell-number');
    await expect(gameNumber).toHaveCSS("font-weight", String(body.weight + 200));
    const goToday = page.locator("#seasonGames .go-today");
    await expect(goToday).toHaveText("Today");
    expect(await readChannels(page, await readColor(goToday, "color"))).toEqual(orange);
    await expect(goToday).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(goToday).toHaveCSS("box-shadow", "none");
  });
}

test("the Games list's month starts 14.5px under the header's line, level with Today and its icon, the weekdays' capitals 16.5px under its, its days 46px wide and 2px apart, a weekday 2px over its date, and the bar ends in a line once a day scrolls under it", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toBeVisible();
  const month = await readCapitals(page.locator("#seasonGames .strip-month"));
  const today = await readCapitals(page.locator("#seasonGames .go-today span"));
  const weekday = await readCapitals(
    page.locator('#seasonGames .day-cell[data-day="2026-09-29"] .cell-name'),
  );
  const boxes = await page.evaluate(() => {
    const readBox = (/** @type {string} */ selector) =>
      /** @type {Element} */ (document.querySelector(selector)).getBoundingClientRect();
    const icon = readBox("#seasonGames .go-today svg");
    const cells = [...document.querySelectorAll("#seasonGames .day-cell")].slice(0, 2);
    const [first, second] = cells.map((cell) => cell.getBoundingClientRect());
    const name = readBox('#seasonGames .day-cell[data-day="2026-09-29"] .cell-name');
    const number = readBox('#seasonGames .day-cell[data-day="2026-09-29"] .cell-number');
    return {
      headerBottom: readBox("header.top").bottom,
      iconMiddle: (icon.top + icon.bottom) / 2,
      width: first.width,
      gap: second.left - first.right,
      nameToNumber: number.top - name.bottom,
    };
  });
  const { headerBottom, iconMiddle, ...steps } = boxes;
  const sizes = {
    above: month.top - headerBottom,
    monthToWeekdays: weekday.top - month.bottom,
    todayFromMonth: today.middle - month.middle,
    iconFromMonth: iconMiddle - month.middle,
  };
  const { above, monthToWeekdays, todayFromMonth, iconFromMonth } = sizes;
  expect(above).toBeCloseTo(14.5, 0);
  expect(monthToWeekdays).toBeCloseTo(16.5, 0);
  expect(todayFromMonth).toBeCloseTo(0, 0);
  expect(iconFromMonth).toBeCloseTo(0, 0);
  expect(steps).toEqual({ width: 46, gap: 2, nameToNumber: 2 });
  const bar = page.locator("#seasonGames .day-bar");
  await expect(bar).toHaveClass(/stuck/);
  const divider = await readTokenColor(page, "--divider");
  await expect(bar).toHaveCSS("box-shadow", `${divider} 0px 1px 0px 0px`);
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  await expect(bar).not.toHaveClass(/stuck/);
});

test("an All-Star team's star sits 1px above its name's middle, where a dot sits level with it", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  await page.locator('#seasonGames .day-cell[data-day="2026-07-25"]').click();
  const readMarkAboveName = (/** @type {string} */ side) =>
    page.locator(side).evaluate((element) => {
      /** @param {Element} part */
      const readMiddle = (part) => {
        const box = part.getBoundingClientRect();
        return (box.top + box.bottom) / 2;
      };
      const mark = /** @type {Element} */ (element.querySelector(".all-star-mark, .dot"));
      return (
        readMiddle(/** @type {Element} */ (element.querySelector(".team-name"))) - readMiddle(mark)
      );
    });
  await expect(page.locator('[data-game="1032600001"] .all-star-mark').first()).toBeInViewport();
  expect(await readMarkAboveName('[data-game="1032600001"] .game-side.away')).toBeCloseTo(1, 1);
  expect(
    await readMarkAboveName(
      '.listed-day[data-day="2026-07-28"] .game-row:first-child .game-side.away',
    ),
  ).toBeCloseTo(0, 1);
});

test("a sheet leaves the page behind it as it is, and a switch stays round", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.locator(SETTINGS);
  await expect(settings).toBeVisible();
  const dim = await settings.evaluate(
    (dialog) => getComputedStyle(dialog, "::backdrop").backgroundColor,
  );
  expect(dim).toBe("rgba(0, 0, 0, 0)");
  const toggle = settings.locator(".switch").first();
  await expect(toggle).toHaveCSS("border-radius", "14px");
  await expect(toggle.locator(".switch-knob")).toHaveCSS("border-radius", "50%");
});
