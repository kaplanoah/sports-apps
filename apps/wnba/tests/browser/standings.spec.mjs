import { test, expect, openApp } from "./harness.mjs";
import { readTokenColor } from "./theme.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { listChipsOffCenter } from "../../../../tests/browser/chip-centering.mjs";
import { readCapitals } from "../../../../tests/browser/capitals.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// The least room between one standings row's team name and the next row's.
const STANDINGS_NAME_GAP_PX = 20;
// The least room between a standings group's name, like Playoffs, and its columns' names under it.
const STANDINGS_HEADING_GAP_PX = 6;

test("the standings leave room between each team's name and the next one's", async ({ page }) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
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
  await openSeasonPart(page, "Standings");
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

test("a standings club's dot and conference tag each center on the middle of its name's capitals", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const cell = page
    .locator("#standings-league .team-cell", { has: page.locator(".conference-tag") })
    .first();
  const tag = cell.locator(".conference-tag");
  await expect(tag).toHaveText(/^[EW]$/);
  const [name, tagCapitals, dot] = await Promise.all([
    readCapitals(cell.locator(".team-name")),
    readCapitals(tag),
    cell.locator(".dot").boundingBox(),
  ]);
  expect(tagCapitals.middle).toBeCloseTo(name.middle, 1);
  expect((dot?.y ?? 0) + (dot?.height ?? 0) / 2).toBeCloseTo(name.middle, 1);
  expect(await listChipsOffCenter(page)).toEqual([]);
});

test("a conference's standings set each seed note's baseline a third of a pixel above its name's", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const cell = page.locator("#standings-east .team-cell", { has: page.locator(".seed-note") });
  await expect(cell.first()).toBeAttached();
  const [note, name] = await Promise.all([
    readCapitals(cell.first().locator(".seed-note")),
    readCapitals(cell.first().locator(".team-name")),
  ]);
  expect(name.bottom - note.bottom).toBeCloseTo(1 / 3, 1);
});

test("the standings' recent form reads a step below the season, in the mid ink", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
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
  await openSeasonPart(page, "Standings");
  const table = await page.locator("#standings-league table.standings").boundingBox();
  const line = await page.locator("#standings-league tr.playoff-line td").boundingBox();
  expect(line.x).toBeCloseTo(table.x, 0);
  expect(line.width).toBeCloseTo(table.width, 0);
});

test("the standings' teams sit on one raised card inside its edge, with their column names on the page and lines only between rows", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
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
  await openSeasonPart(page, "Standings");
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
  await openSeasonPart(page, "Standings");
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

  test("the standings show every column, in the playoffs and before them, with a winning streak below the line paler than one above it", async ({
    page,
  }) => {
    const app = await openApp(page);
    await openSeasonPart(page, "Standings");
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
    await openSeasonPart(page, "Standings");
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

test("the league and each conference stack one under another, each named at its table's edge in the teal of the column groups, the first 3.5px under the pill's bar", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-west")).toBeAttached();
  const teal = await readTokenColor(page, "--structure");

  const lists = await page.locator(".standings-list").evaluateAll((all) =>
    all.map((list) => {
      const table = /** @type {Element} */ (list.querySelector("table"));
      const title = /** @type {HTMLElement} */ (list.querySelector("th.list-title"));
      const words = document.createRange();
      words.selectNodeContents(title);
      return {
        id: list.id,
        title: title.textContent,
        color: getComputedStyle(title).color,
        titleOffset: words.getBoundingClientRect().left - table.getBoundingClientRect().left,
        top: table.getBoundingClientRect().top,
        bottom: table.getBoundingClientRect().bottom,
      };
    }),
  );

  expect(lists.map(({ id, title }) => [id, title])).toEqual([
    ["standings-league", "League"],
    ["standings-east", "East"],
    ["standings-west", "West"],
  ]);
  for (const list of lists) {
    expect(list.color, list.id).toBe(teal);
    expect(list.titleOffset, list.id).toBeCloseTo(0, 0);
  }
  expect(lists[1].top).toBeGreaterThan(lists[0].bottom);
  expect(lists[2].top).toBeGreaterThan(lists[1].bottom);
  const pillBottom = await page
    .locator("#bracketStandingsPill")
    .evaluate((bar) => bar.getBoundingClientRect().bottom);
  expect(lists[0].top - pillBottom).toBeCloseTo(3.5, 1);
});

/**
 * Where each standings card ends across the screen, where its column ends inside the page's
 * margin, and how wide the page scrolls.
 * @param {import("@playwright/test").Page} page
 */
const readStandingsEdges = (page) =>
  page.evaluate(() => ({
    cards: [...document.querySelectorAll("#standingsWrap table.standings")].map((table) => {
      const list = /** @type {HTMLElement} */ (table.closest(".standings-list"));
      return {
        right: table.getBoundingClientRect().right,
        columnRight:
          list.getBoundingClientRect().right - parseFloat(getComputedStyle(list).paddingRight),
      };
    }),
    pageWidth: document.documentElement.scrollWidth,
  }));

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} width
 */
async function openStandingsAt(page, width) {
  await page.setViewportSize({ width, height: 780 });
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-west")).toBeAttached();
}

// The layout's rounding where a card fills its column exactly.
const LAYOUT_ROUNDING_PX = 0.5;

test("on a 375px phone, every standings card fits inside the page's margin, and the page doesn't scroll sideways", async ({
  page,
}) => {
  await openStandingsAt(page, 375);

  const { cards, pageWidth } = await readStandingsEdges(page);
  expect(cards).toHaveLength(3);
  for (const { right, columnRight } of cards)
    expect(right).toBeLessThanOrEqual(columnRight + LAYOUT_ROUNDING_PX);
  expect(pageWidth).toBe(375);
});

test("on a 360px phone, every standings card ends inside the screen, its right edge showing, and the page doesn't scroll sideways", async ({
  page,
}) => {
  await openStandingsAt(page, 360);

  const { cards, pageWidth } = await readStandingsEdges(page);
  expect(cards).toHaveLength(3);
  for (const { right } of cards) expect(right).toBeLessThanOrEqual(360);
  expect(pageWidth).toBe(360);
});

test("on a 390px phone, the standings keep their full gaps between columns", async ({ page }) => {
  await openStandingsAt(page, 390);

  const row = page.locator("#standings-west tbody tr[data-team]").first();
  const gaps = await row.evaluate((element) =>
    ["td.season:not(.pair-end)", "td.season.pair-end", "td.recent-start"].map(
      (selector) =>
        getComputedStyle(/** @type {Element} */ (element.querySelector(selector))).paddingLeft,
    ),
  );
  expect(gaps).toEqual(["12px", "16px", "21px"]);
});
