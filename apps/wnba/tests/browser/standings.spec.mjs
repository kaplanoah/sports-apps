import { test, expect, openApp } from "./harness.mjs";
import {
  listFillFades,
  noteNameFades,
  readFilledNames,
} from "../../../../tests/browser/pill-names.mjs";
import { drag, swipeScrollerTo } from "../../../../tests/browser/touch.mjs";
import { readTokenColor } from "./theme.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// The least room between one standings row's team name and the next row's.
const STANDINGS_NAME_GAP_PX = 20;
// The least room between a standings group's name, like Playoffs, and its columns' names under it.
const STANDINGS_HEADING_GAP_PX = 6;

test.describe("on a phone, the standings", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("swipe sideways from the league to a conference, and the pill follows", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const pages = page.locator("#standings-pages");
    await expect(page.locator("#standings-league")).toContainText("Lynx");

    await swipeScrollerTo(pages, 1);

    await expect(page.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#standings-east")).toBeInViewport();
    const box = await pages.boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
  });

  test("come back from another tab held for where the page is now, not where it was when they left", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect(page.locator("#standings-league")).toContainText("Lynx");
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    const bar = page.locator("#standings-bar");
    await expect(bar).toHaveClass(/stuck/);
    await expect(page.locator("#standings-east")).not.toHaveCSS("transform", "none");

    await page.getByRole("tab", { name: "Bracket" }).click();
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("tab", { name: "Standings" }).click();

    await expect(bar).not.toHaveClass(/stuck/);
    await expect(bar).toHaveCSS("background-image", "none");
    await expect(page.locator("#standings-east")).toHaveCSS("transform", "none");
  });
});

test("the standings leave room between each team's name and the next one's", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const names = page.locator("#standings-league tbody td.team");
  await expect(names.first()).toBeVisible();
  const gaps = await names.evaluateAll((cells) =>
    cells.slice(1, 4).map((cell, index) => {
      const above = cells[index].querySelector(".team-name") ?? cells[index];
      const below = cell.querySelector(".team-name") ?? cell;
      return below.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
    }),
  );
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(STANDINGS_NAME_GAP_PX);
});

test("the standings leave room between each group's name and its columns' names", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const heads = page.locator("#standings-league thead");
  await expect(heads.locator("tr.groups th.recent-start")).toHaveText("Playoffs");
  await expect(heads.locator("th.recent-start").last()).toHaveText("Rd 1");
  const gap = await heads.evaluate((head) => {
    const measureText = (cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return range.getBoundingClientRect();
    };
    const [group, column] = [...head.querySelectorAll("th.recent-start")].map(measureText);
    return column.top - group.bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(STANDINGS_HEADING_GAP_PX);
});

test("a standings conference tag's letter is trimmed to its capital, with even room around it", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const tag = page.locator("#standings-league .conference-tag").first();
  await expect(tag).toHaveText(/^[EW]$/);
  const room = await tag.evaluate((element) => {
    const style = getComputedStyle(element);
    const content =
      element.getBoundingClientRect().height -
      ["borderTopWidth", "borderBottomWidth", "paddingTop", "paddingBottom"]
        .map((side) => parseFloat(style[side]))
        .reduce((sum, value) => sum + value);
    return {
      content,
      fontSize: parseFloat(style.fontSize),
      above: style.paddingTop,
      below: style.paddingBottom,
    };
  });
  expect(room.content).toBeLessThan(room.fontSize * 0.8);
  expect(room.above).toBe(room.below);
});

test("the Standings pill switches between the league and each conference, through the season's updates and back from another tab", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const pill = page.getByRole("tablist", { name: "Standings" });
  const shownFirstTeam = page.locator(".pager-page:not([inert]) tbody tr").first();
  await expect(page.getByRole("table", { name: "League standings" })).toBeInViewport();
  await expect(shownFirstTeam).toContainText("Lynx");

  await pill.getByRole("tab", { name: "East" }).click();

  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();
  await expect(shownFirstTeam).toContainText("Dream");
  await expect(pill.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");

  await app.changeSeason((season) => {
    season.standings.find((row) => row.team === "ATL").wins += 1;
    return season;
  });
  await expect(shownFirstTeam).toContainText("31-14");
  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();

  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();
  await expect(pill.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");
});

test("the standings' recent form reads a step below the season, in the mid ink", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const lynx = page.locator('#standings-league tr[data-team="MIN"]');
  await expect(lynx).toBeVisible();
  const readType = (cell) =>
    cell.evaluate((element) => {
      const { fontSize, fontWeight, color } = getComputedStyle(element);
      return { size: parseFloat(fontSize), weight: fontWeight, color };
    });
  const season = await readType(lynx.locator("td.season").first());
  const recent = await readType(lynx.locator("td.recent").first());
  const middle = await readTokenColor(page, "--ink-mid");

  expect(recent.size).toBeLessThan(season.size);
  expect(recent.size).toBeGreaterThanOrEqual(12.8);
  expect([recent.weight, recent.color]).toEqual(["500", middle]);
});

test("the playoff line is one dashed strip across the whole table", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = await page.locator("#standings-league table.standings").boundingBox();
  const line = await page.locator("#standings-league tr.playoff-line td").boundingBox();
  expect(line.x).toBeCloseTo(table.x, 0);
  expect(line.width).toBeCloseTo(table.width, 0);
});

test("the standings' teams sit on one raised card inside its edge, with their column names on the page and lines only between rows", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = page.locator("#standings-league table.standings");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const [raised, edge, divider] = await Promise.all(
    ["--raised", "--edge", "--divider"].map((token) => readTokenColor(page, token)),
  );

  const readCells = (selector) =>
    table.locator(selector).evaluateAll((cells) =>
      cells.map((cell) => {
        const style = getComputedStyle(cell);
        return {
          background: style.backgroundColor,
          top: style.borderTopStyle === "none" ? null : style.borderTopColor,
          bottom: style.borderBottomStyle === "none" ? null : style.borderBottomColor,
          left: style.borderLeftStyle === "none" ? null : style.borderLeftColor,
          right: style.borderRightStyle === "none" ? null : style.borderRightColor,
        };
      }),
    );
  const heads = await readCells("thead th");
  expect(new Set(heads.map((head) => head.background))).toEqual(new Set(["rgba(0, 0, 0, 0)"]));

  const rows = await table.locator("tbody tr[data-team]").count();
  const first = await readCells("tbody tr[data-team]:first-child td");
  const inside = await readCells("tbody tr[data-team]:nth-child(3) td");
  const last = await readCells("tbody tr[data-team]:last-child td");
  for (const cells of [first, inside, last]) {
    expect(new Set(cells.map((cell) => cell.background))).toEqual(new Set([raised]));
    expect([cells[0].left, cells.at(-1).right]).toEqual([edge, edge]);
  }
  expect(new Set(first.map((cell) => cell.top))).toEqual(new Set([edge]));
  expect(new Set(inside.map((cell) => cell.top))).toEqual(new Set([divider]));
  expect(new Set(inside.map((cell) => cell.bottom))).toEqual(new Set([null]));
  expect(new Set(last.map((cell) => cell.bottom))).toEqual(new Set([edge]));
  expect(rows).toBeGreaterThan(3);
});

test("the standings' widest value in the last column ends 10px in from the card's right edge", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = page.locator("#standings-league table.standings");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const rooms = await table.locator("tbody td:last-child").evaluateAll((cells) =>
    cells.map((cell) => {
      const text = document.createRange();
      text.selectNodeContents(cell);
      const edge =
        cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).borderRightWidth);
      return edge - text.getBoundingClientRect().right;
    }),
  );

  expect(Math.min(...rooms)).toBeCloseTo(10, 0);
});

test("the standings' ranks sit 10px in from the card's edge and 6px before the names, which all start in one place", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = page.locator("#standings-league table.standings");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const [one, ten] = await Promise.all(
    ["1", "10"].map((place) =>
      table
        .locator("tbody tr", {
          has: page.locator("td.place", { hasText: new RegExp(`^${place}$`) }),
        })
        .evaluate((row) => {
          const place = /** @type {HTMLElement} */ (row.querySelector("td.place"));
          const cell = place.getBoundingClientRect();
          const room = cell.right - parseFloat(getComputedStyle(place).paddingRight);
          const number = document.createRange();
          number.selectNodeContents(place);
          const shown = number.getBoundingClientRect();
          const name = row.querySelector(".club").getBoundingClientRect().left;
          return {
            numberIn: shown.left - cell.left,
            spareAfterNumber: room - shown.right,
            roomToName: name - room,
            nameIn: name - cell.left,
          };
        }),
    ),
  );
  expect(ten.numberIn).toBeCloseTo(11, 0);
  expect(ten.spareAfterNumber).toBeGreaterThanOrEqual(0);
  // A browser may draw a table's column up to a pixel wider than its widest content.
  expect(ten.spareAfterNumber).toBeLessThanOrEqual(1);
  expect(ten.roomToName).toBeCloseTo(6, 0);
  expect(one.numberIn).toBeCloseTo(11, 0);
  expect(one.nameIn).toBeCloseTo(ten.nameIn, 0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const readStandingsPosition = (page) =>
    page.locator("#standings-pages").evaluate((pages) => pages.scrollLeft / pages.clientWidth);

  /**
   * Starts noting where the standings' lists were each time the pill changed its chosen name.
   * @param {import("@playwright/test").Page} page
   * @returns {Promise<() => Promise<{ name: string, position: number }[]>>}
   */
  async function noteNameChoices(page) {
    await page.evaluate(() => {
      const choices = /** @type {object[]} */ ([]);
      const pages = /** @type {HTMLElement} */ (document.getElementById("standings-pages"));
      new MutationObserver((records) => {
        for (const record of records) {
          const tab = /** @type {HTMLElement} */ (record.target);
          if (tab.getAttribute("aria-selected") !== "true") continue;
          choices.push({
            name: (tab.textContent ?? "").trim(),
            position: pages.scrollLeft / pages.clientWidth,
          });
        }
      }).observe(/** @type {Node} */ (document.querySelector("#standings-bar [role=tablist]")), {
        attributes: true,
        attributeFilter: ["aria-selected"],
        subtree: true,
      });
      Object.assign(window, { nameChoices: choices });
    });
    return () => page.evaluate(() => /** @type {any} */ (window).nameChoices);
  }

  test("a tap on a name two over hands the pill's fill straight there, the old name's fading out as the new one's fades in, eased alike, the new name's letters a beat behind, and the name between never filling", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect(page.getByRole("tab", { name: "League" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const tabList = page.locator("#standings-bar [role=tablist]");
    const readChoices = await noteNameChoices(page);
    const readFades = await noteNameFades(tabList);

    await page.getByRole("tab", { name: "West" }).click();

    await expect.poll(() => readStandingsPosition(page)).toBe(2);
    const [choice, ...later] = await readChoices();
    expect(choice).toEqual({ name: "West", position: 0 });
    expect(later).toEqual([]);
    const fades = await readFades();
    expect(listFillFades(fades)).toEqual([
      "League 0.18s 0s ease-in-out",
      "West 0.18s 0s ease-in-out",
    ]);
    const [leagueFrame, westFrame] = fades
      .filter(({ property }) => property === "background-color")
      .map(({ frame }) => frame);
    expect(westFrame).toBe(leagueFrame);
    const letterFades = fades
      .filter(({ property }) => property === "color")
      .map(({ name, duration, delay }) => `${name} ${duration} ${delay}`)
      .sort();
    expect(letterFades).toEqual(["League 0.18s 0s", "West 0.2s 0.025s"]);
    expect(await readFilledNames(tabList)).toEqual(["West"]);
  });

  test("with reduced motion, a tap moves the pill's fill at once, fading nothing", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const tabList = page.locator("#standings-bar [role=tablist]");
    const readFades = await noteNameFades(tabList);

    await page.getByRole("tab", { name: "West" }).click();

    await expect.poll(() => readStandingsPosition(page)).toBe(2);
    expect(await readFilledNames(tabList)).toEqual(["West"]);
    expect(await readFades()).toEqual([]);
  });

  test("a finger swiping the standings past halfway leaves the pill as it is while it moves them, and once it lifts, the pill hands off to the list they snap to as they set off", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect.poll(() => readStandingsPosition(page)).toBe(0);
    const tabList = page.locator("#standings-bar [role=tablist]");
    const readChoices = await noteNameChoices(page);
    const readFades = await noteNameFades(tabList);

    const release = await drag(page, { x: 330, y: 500 }, { x: -250 }, { durationMs: 1000 });
    const liftPosition = await readStandingsPosition(page);
    expect(liftPosition).toBeGreaterThan(0.5);
    expect(liftPosition).toBeLessThan(0.9);
    expect(await readChoices()).toEqual([]);
    expect(await readFilledNames(tabList)).toEqual(["League"]);
    await release();

    await expect(page.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => readStandingsPosition(page)).toBe(1);
    const [choice, ...later] = await readChoices();
    expect(choice.name).toBe("East");
    expect(choice.position).toBeGreaterThan(liftPosition);
    expect(choice.position).toBeLessThan(0.98);
    expect(later).toEqual([]);
    expect(listFillFades(await readFades())).toEqual([
      "East 0.18s 0s ease-in-out",
      "League 0.18s 0s ease-in-out",
    ]);
  });

  test("a finger swiping the standings short of halfway leaves the pill as it is, and once it lifts, the lists spring back with the pill never changing", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await expect.poll(() => readStandingsPosition(page)).toBe(0);
    const tabList = page.locator("#standings-bar [role=tablist]");
    const readChoices = await noteNameChoices(page);
    const readFades = await noteNameFades(tabList);

    const release = await drag(page, { x: 330, y: 500 }, { x: -120 }, { durationMs: 1000 });
    expect(await readStandingsPosition(page)).toBeGreaterThan(0.2);
    await release();

    await expect.poll(() => readStandingsPosition(page)).toBe(0);
    expect(await readChoices()).toEqual([]);
    expect(await readFades()).toEqual([]);
    expect(await readFilledNames(tabList)).toEqual(["League"]);
  });

  test("the standings show every column, in the playoffs and before them, with a winning streak below the line paler than one above it", async ({
    page,
  }) => {
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const table = page.getByRole("table", { name: "League standings" });
    for (const heading of ["W-L", "GB", "Rd 1", "Now"]) {
      await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    await app.changeSeason((season) => ({ ...season, series: [] }));
    for (const heading of ["W-L", "GB", "L10", "Strk"]) {
      await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    const readStreakColor = (team) =>
      page
        .locator("#standings-league tbody tr", { hasText: team })
        .locator("td.recent.pair-end")
        .evaluate((streak) => getComputedStyle(streak).color);
    expect(await readStreakColor("Fire")).not.toBe(await readStreakColor("Lynx"));
  });

  test("a tap anywhere on a team's row in the standings, beside its name or on its numbers, lands on the team's button and opens its sheet", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const row = page.locator('#standings-league tr[data-team="ATL"]');
    await expect(row).toBeVisible();
    const cells = await row.locator("td").evaluateAll((all) =>
      all.map((cell) => {
        const box = cell.getBoundingClientRect();
        return { x: box.right - 2, y: box.top + box.height / 2 };
      }),
    );
    for (const spot of cells) {
      const target = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.team,
        spot,
      );
      expect(target).toBe("ATL");
    }

    await page.touchscreen.tap(cells[2].x, cells[2].y);
    await expect(page.locator("#teamSheet #teamTitle")).toHaveText("Atlanta Dream");
  });
});
