import {
  test,
  expect,
  openApp,
  buildFixtureSnapshot,
  buildSnapshotWithStarters,
  EVENING_FIXTURE,
  readColor,
  SCHEDULE_DOCS,
} from "./harness.mjs";
import { readCapitals } from "../../../../tests/browser/capitals.mjs";
import { readRole } from "../../../../tests/browser/type-roles.mjs";
import { readStripEdges } from "../../../../tests/browser/day-strip-edges.mjs";
import {
  listLowContrastText,
  listLowContrastTextAsShown,
} from "../../../../tests/browser/contrast.mjs";
import { PHONE, WIDE_SCREEN } from "./screen-sizes.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * Opens the Games tab on the whole season, once the store's schedule has drawn its first day.
 * @param {import("@playwright/test").Page} page
 */
async function openSeasonGames(page) {
  await page.setViewportSize(PHONE);
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-03-25",
  );
}

/**
 * Scrolls the Games list by `distance` and reads where `day`'s heading and the list's top are.
 * @param {import("@playwright/test").Page} page
 * @param {number} distance
 * @param {string[]} days
 */
const scrollAndReadHeadings = (page, distance, days) =>
  page.locator("#seasonGames .day-list").evaluate(
    (list, { distance, days }) => {
      list.scrollTop += distance;
      const listTop = list.getBoundingClientRect().top;
      return days.map((day) => {
        const heading = list.querySelector(`[data-day="${day}"] .day-heading`);
        const box = heading.getBoundingClientRect();
        return { top: box.top - listTop, bottom: box.bottom - listTop };
      });
    },
    { distance, days },
  );

test("the Games tab lists the whole season under a strip of its days, opening on today under its heading", async ({
  page,
}) => {
  await openSeasonGames(page);

  const today = page.locator('#seasonGames .listed-day[data-day="2026-09-24"]');
  await expect(today).toBeInViewport();
  await expect(today.locator(".day-heading")).toHaveText("Today•Thu, Sep 24");
  await expect(page.locator('#seasonGames .day-cell[aria-current="date"]')).toHaveAttribute(
    "data-day",
    "2026-09-24",
  );
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    "2026-09-24",
  );
  await expect(
    page.locator('#seasonGames .listed-day[data-day="2026-09-23"] .day-heading'),
  ).toHaveText("Yesterday•Wed, Sep 23");
  await expect(
    page.locator('#seasonGames .listed-day[data-day="2026-09-26"] .day-heading'),
  ).toHaveText("Sat, Sep 26");
});

test("the Games list's month starts 15px under the header's line, with Today's capitals level with its", async ({
  page,
}) => {
  await openSeasonGames(page);

  const headerBottom = await page
    .locator("header.top")
    .evaluate((header) => header.getBoundingClientRect().bottom);
  const month = await readCapitals(page.locator("#seasonGames .strip-month"));
  expect(month.top - headerBottom).toBeCloseTo(15, 0);
  const today = await readCapitals(page.locator("#seasonGames .go-today > span"));
  expect(Math.abs(today.top - month.top)).toBeLessThan(0.25);
});

test("a reload keeps the whole season in the Games list while the store catches up, never dropping to the slate's few days", async ({
  page,
}) => {
  await openSeasonGames(page);
  await page.addInitScript(() => {
    const counts = /** @type {number[]} */ ([]);
    Object.assign(window, { listedDayCounts: counts });
    new MutationObserver(() => {
      const count = document.querySelectorAll("#seasonGames .listed-day").length;
      if (count && count !== counts.at(-1)) counts.push(count);
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  await page.clock.runFor(2000);

  const counts = await page.evaluate(() => Reflect.get(window, "listedDayCounts"));
  expect(counts).toEqual([counts[0]]);
  expect(counts[0]).toBeGreaterThan(200);
});

test("a day's heading holds under the strip while its games pass, until the next day's pushes it out", async ({
  page,
}) => {
  await openSeasonGames(page);
  const days = ["2026-09-24", "2026-09-25"];

  const [held] = await scrollAndReadHeadings(page, 400, days);
  expect(Math.abs(held.top)).toBeLessThan(1);

  const nextTop = (await scrollAndReadHeadings(page, 0, days))[1].top;
  const [pushed, next] = await scrollAndReadHeadings(page, nextTop - 10, days);
  expect(Math.abs(next.top - 10)).toBeLessThan(1);
  expect(pushed.bottom).toBeLessThanOrEqual(next.top + 0.5);
});

test("each day's heading is a band of the page's color, ending in a line, its capitals a label", async ({
  page,
}) => {
  await openSeasonGames(page);
  const heading = page.locator('#seasonGames .listed-day[data-day="2026-09-23"] .day-heading');
  const pageColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await expect(heading).toHaveCSS("background-color", pageColor);
  await expect(heading).toHaveCSS("font-size", `${(await readRole(page, "label")).size}px`);
  await expect(heading).toHaveCSS("text-transform", "uppercase");
  await expect(heading).toHaveCSS("box-shadow", /0px 1px 0px 0px$/);
  await expect(
    page.locator('#seasonGames .listed-day[data-day="2026-09-24"] .day-heading'),
  ).toHaveCSS("color", await readColor(page, "--highlight"));
});

test("a day far from the list's top stands in for its games at the height they take once drawn, so the page holds only the games near the screen", async ({
  page,
}) => {
  await openSeasonGames(page);
  const games = page.locator('#seasonGames .listed-day[data-day="2026-06-10"] .game-list');
  await expect(games).toHaveClass(/is-stand-in/);
  await expect(games.locator(".game-row")).toHaveCount(0);
  const heightAway = await games.evaluate((list) => list.getBoundingClientRect().height);
  const drawnRows = await page.locator("#seasonGames .game-row").count();
  expect(drawnRows).toBeLessThan(200);

  await page.locator('#seasonGames .day-cell[data-day="2026-06-10"]').click();
  await expect(games.locator(".game-row").first()).toBeInViewport();
  await expect(games).not.toHaveClass(/is-stand-in/);
  expect(await games.evaluate((list) => list.getBoundingClientRect().height)).toBe(heightAway);
  await expect(
    page.locator('#seasonGames .listed-day[data-day="2026-09-24"] .game-list'),
  ).toHaveClass(/is-stand-in/);
});

test("the Games view keeps its height as the season's days change the list's height", async ({
  page,
}) => {
  await openSeasonGames(page);
  const heights = await page.locator("#seasonGames").evaluate((view) => {
    const day = /** @type {HTMLElement} */ (view.querySelector('[data-day="2026-04-01"]'));
    return Array.from({ length: 40 }, (_, step) => {
      day.style.paddingTop = `${step * 0.37}px`;
      return view.getBoundingClientRect().height;
    });
  });

  expect(new Set(heights).size).toBe(1);
});

test("scrolling the list draws each day whole as it nears the top, before it shows", async ({
  page,
}) => {
  await openSeasonGames(page);
  const list = page.locator("#seasonGames .day-list");
  for (let step = 0; step < 20; step += 1) {
    await list.evaluate((element) => element.scrollBy(0, element.clientHeight));
    await expect
      .poll(() =>
        list.evaluate((element) => {
          const top = element.getBoundingClientRect().top;
          const bottom = top + element.clientHeight;
          return [...element.querySelectorAll(".game-list.is-stand-in")].filter((standIn) => {
            const box = standIn.getBoundingClientRect();
            return box.bottom > top && box.top < bottom;
          }).length;
        }),
      )
      .toBe(0);
  }
});

test("a schedule that arrives after the slate's days were drawn again fills the strip with every day, as it does the list", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .day-cell").first()).toHaveAttribute(
    "data-day",
    "2026-09-23",
  );
  const season = await app.readDocument("seasons/2026");
  const scored = structuredClone(season);
  scored.slate.today.games.find((/** @type {any} */ game) => game.id === "824866").score = [6, 5];
  await app.writeFromWorker("seasons/2026", scored);
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 6-5/);

  for (const [path, month] of Object.entries(SCHEDULE_DOCS)) await app.writeFromWorker(path, month);

  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-03-25",
  );
  await expect(page.locator("#seasonGames .day-cell").first()).toHaveAttribute(
    "data-day",
    "2026-03-25",
  );
});

test("tapping the Games tab while it shows goes back to today", async ({ page }) => {
  await openSeasonGames(page);
  await page.locator('#seasonGames .day-cell[data-day="2026-06-10"]').click();
  await expect(page.locator('#seasonGames .listed-day[data-day="2026-06-10"]')).toBeInViewport();

  await page.getByRole("tab", { name: "Games" }).click();

  await expect(page.locator('#seasonGames .listed-day[data-day="2026-09-24"]')).toBeInViewport();
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    "2026-09-24",
  );
});

test("after a tap on the Games tab while the list is already on today, the strip follows a scroll that no finger or wheel makes, as a keyboard's does", async ({
  page,
}) => {
  await openSeasonGames(page);
  await expect(page.locator("#seasonGames")).toHaveAttribute("data-held-arrived", "true");
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames")).toHaveAttribute("data-held-arrived", "true");

  await page.locator("#seasonGames .day-list").evaluate((list) => {
    const next = /** @type {HTMLElement} */ (list.querySelector('[data-day="2026-09-25"]'));
    list.scrollTop = next.offsetTop;
  });

  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    "2026-09-25",
  );
});

test("a doubleheader shows as two games on its date, with no game number", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const doubleheader = page
    .locator("#seasonGames .game-row")
    .filter({ hasText: "Blue Jays" })
    .filter({ hasText: "Orioles" });

  await expect(doubleheader).toHaveCount(2);
  await expect(doubleheader.locator(".game-status")).toHaveText(["Final", "Final"]);
});

test("a game still to come shows its start time centered in its row", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator("#seasonGames .game-day.is-today .game-row.pre").first();
  const rowBox = await row.boundingBox();
  const timeBox = await row.locator(".game-time").boundingBox();
  const findCenterX = (box) => box.x + box.width / 2;

  expect(Math.abs(timeBox.y + timeBox.height / 2 - (rowBox.y + rowBox.height / 2))).toBeLessThan(1);
  expect(Math.abs(findCenterX(timeBox) - findCenterX(rowBox))).toBeLessThan(1);
});

// Today's postseason games, each naming its series and its game in it, after the series' earlier
// games, the day before.
const openPostseasonDay = async (page, games, earlierGames) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  /** @param {string} start */
  const describeGame = (start) => (game) => ({
    id: `${game.away}-${game.home}-${game.date ?? start}`,
    state: "pre",
    start,
    postseason: true,
    ...game,
  });
  snapshot.slate.today.games = games.map(describeGame("2026-09-24T18:08:00Z"));
  snapshot.slate.previous = earlierGames.map((game) => ({
    date: "2026-09-23",
    ...describeGame("2026-09-23T18:08:00Z")({ state: "final", number: 1, ...game }),
  }));
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  await page.getByRole("tab", { name: "Games" }).click();
};

const openWildCardDay = (page) =>
  openPostseasonDay(
    page,
    [
      { away: "PHI", home: "ATL", series: "NL_WC1", number: 2 },
      {
        away: "CWS",
        home: "TEX",
        series: "AL_WC1",
        number: 2,
        state: "live",
        score: [3, 1],
        inning: 5,
        half: "top",
      },
      { away: "BOS", home: "NYY", series: "AL_WC2", number: 2, state: "final", score: [4, 6] },
      { away: "CHC", home: "SD", series: "NL_WC2", number: 2, state: "final", score: [5, 2] },
    ],
    [
      { away: "PHI", home: "ATL", series: "NL_WC1", score: [3, 5] },
      { away: "CWS", home: "TEX", series: "AL_WC1", score: [4, 2] },
      { away: "BOS", home: "NYY", series: "AL_WC2", score: [7, 1] },
      { away: "CHC", home: "SD", series: "NL_WC2", score: [6, 0] },
    ],
  );

test("a postseason game today names its round and the series, away wins first, over its time or score", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openWildCardDay(page);
  const labels = page.locator("#seasonGames .game-day.is-today .series-label");

  await expect(labels).toHaveText(["NL WC 0-1", "AL WC 1-0", "AL WC 1-1", "NL WC 2-0"]);
  await expect(labels.first()).toHaveCSS("text-transform", "uppercase");
  await expect(labels.first()).toHaveCSS("color", await readColor(page, "--ink-dim"));
  await expect(labels.last()).toHaveCSS("color", await readColor(page, "--highlight"));
  await expect(labels.last().locator(".series-count")).toHaveCSS(
    "color",
    await readColor(page, "--highlight"),
  );

  const row = await page.locator("#seasonGames .game-day.is-today .game-row").first().boundingBox();
  const time = await page.locator("#seasonGames .game-day.is-today .game-time").boundingBox();
  expect(Math.abs(time.x + time.width / 2 - (row.x + row.width / 2))).toBeLessThan(1);
});

test("with starters named, each sits under its club with his arm, clear of the row's edges", async ({
  page,
}) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator("#seasonGames .game-day.is-today .game-row:has(.starter:not(.pending))");
  const box = await row.boundingBox();
  const clubs = await row.locator(".game-side.away").boundingBox();
  const time = await row.locator(".game-time").boundingBox();
  const facts = await row.locator(".game-side.away .game-facts").boundingBox();
  const starter = await row.locator(".starter.away").boundingBox();

  const home = await row.locator(".game-side.home").boundingBox();

  await expect(row.locator(".starter")).toHaveText(["BlubaughR", "SpringsL"]);
  expect(clubs.x).toBeLessThan(time.x);
  expect(time.x + time.width).toBeLessThan(home.x);
  expect(starter.y - (facts.y + facts.height)).toBeCloseTo(4, 1);
  expect(clubs.y - box.y).toBeGreaterThan(8);
  expect(box.y + box.height - (starter.y + starter.height)).toBeGreaterThan(8);
});

test("on the narrowest phone, a club's race letter stays on its record's line, clear of the score", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page
    .locator("#seasonGames .game-day.is-today .game-row:has(.game-side.home .race)")
    .first();
  const facts = row.locator(".game-side.home .game-facts");
  await facts.locator(".tabular").evaluate((record) => (record.textContent = "103-59"));
  const tops = await facts.evaluate((element) =>
    [...element.children].map((child) => Math.round(child.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  const middle = await row.locator(".game-headline").boundingBox();
  expect((await facts.boundingBox()).x).toBeGreaterThan(middle.x + middle.width);
});

test("a clinched club's race letter is gold at the facts' own weight", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const race = page.locator("#seasonGames .game-day.is-today .race.clinched").first();
  await expect(race).toHaveCSS("color", await readColor(page, "--highlight"));
  await expect(race).toHaveCSS("font-weight", String((await readRole(page, "caption")).weight));
});

for (const [theme, colorScheme] of /** @type {const} */ ([
  ["Ball", "light"],
  ["Night Game", "dark"],
])) {
  test(`in ${theme}, a racing club's race letter stays readable on its row under the mouse and pressed`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    const open = page
      .locator("#seasonGames .game-day.is-today .game-row:has(.race.racing) .game-open")
      .first();

    await open.hover();
    expect(await listLowContrastText(page)).toEqual([]);

    await open.evaluate((button) => button.classList.add("is-pressed"));
    expect(await listLowContrastTextAsShown(page)).toEqual([]);
  });
}

test("on a phone, a long starter's name keeps his arm on its line", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  const starter = page.locator("#seasonGames .game-day.is-today .starter.home:not(.pending)");
  const readHeight = async () => (await starter.boundingBox()).height;
  const oneLine = await readHeight();
  await starter.locator(".starter-name").evaluate((name) => (name.textContent = "Misiorowski"));
  expect(await readHeight()).toBe(oneLine);
});

test("a game still to come is as tall as a finished one", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const readRowHeight = async (state) =>
    (await page.locator(`#seasonGames .game-day.is-today .game-row.${state}`).first().boundingBox())
      .height;

  expect(await readRowHeight("pre")).toBe(await readRowHeight("final"));
});

const readToken = (page, token) =>
  page.evaluate(
    (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)),
    token,
  );

// How far each piece's middle sits below its row's, measured on the row's middle column.
const measureOffsets = (row, selectors) =>
  row.evaluate((element, pieces) => {
    const middle = element.querySelector(".game-middle").getBoundingClientRect();
    const findCenter = (box) => box.top + box.height / 2;
    return pieces.map(
      (piece) =>
        findCenter(element.querySelector(piece).getBoundingClientRect()) - findCenter(middle),
    );
  }, selectors);

// Measured on the text itself, which is what has to sit where the offsets say.
test("every game is one height, with each piece at its own offset from the row's middle", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openWildCardDay(page);
  const [height, side, label, headline, status] = await Promise.all(
    ["height", "side", "label", "headline", "status"].map((piece) =>
      readToken(page, piece === "height" ? "--game-row-height" : `--game-${piece}-offset`),
    ),
  );
  const rows = page.locator("#seasonGames .game-day.is-today .game-row");
  for (const row of await rows.all()) expect((await row.boundingBox()).height).toBe(height);

  const live = rows.filter({ has: page.locator(".game-status") }).first();
  const offsets = await measureOffsets(live, [
    ".game-side.away",
    ".series-label",
    ".game-score",
    ".game-status",
  ]);
  for (const [index, expected] of [side, label, headline, status].entries())
    expect(offsets[index]).toBeCloseTo(expected, 1);
  const upcoming = rows.filter({ has: page.locator(".game-time") }).first();
  expect((await measureOffsets(upcoming, [".game-time"]))[0]).toBeCloseTo(headline, 1);
});

test("a game MLB may not need says IF NECESSARY under its time, in capitals, lower than any other status", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openPostseasonDay(
    page,
    [{ away: "PHI", home: "ATL", series: "NL_WC1", number: 3, ifNecessary: true }],
    [
      { away: "PHI", home: "ATL", series: "NL_WC1", score: [3, 5], date: "2026-09-22" },
      { away: "PHI", home: "ATL", series: "NL_WC1", number: 2, score: [4, 3] },
    ],
  );
  const row = page.locator("#seasonGames .game-day.is-today .game-row");
  await expect(row.locator(".series-label")).toHaveText("NL WC 1-1");
  const status = row.locator(".if-necessary");
  await expect(status).toHaveText("If necessary");
  await expect(status).toHaveCSS("text-transform", "uppercase");
  await expect(status).toHaveCSS("color", await readColor(page, "--ink-dim"));
  const [label, time, ifNecessary] = await measureOffsets(row, [
    ".series-label",
    ".game-time",
    ".if-necessary",
  ]);
  expect(label).toBeCloseTo(await readToken(page, "--game-label-offset"), 1);
  expect(time).toBeCloseTo(await readToken(page, "--game-headline-offset"), 1);
  expect(ifNecessary).toBeCloseTo(await readToken(page, "--game-if-necessary-offset"), 1);
  expect(ifNecessary).toBeGreaterThan(await readToken(page, "--game-status-offset"));
});

test("without a series line, a time centers in its row, and a score and its status center as a pair", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const headline = await readToken(page, "--game-headline-offset");
  const status = await readToken(page, "--game-status-offset");
  const rows = page.locator("#seasonGames .game-day.is-today .game-row");
  const [timeOffset] = await measureOffsets(
    rows.filter({ has: page.locator(".game-time") }).first(),
    [".game-time"],
  );
  expect(timeOffset).toBeCloseTo(0, 1);
  const [scoreOffset, statusOffset] = await measureOffsets(
    rows.filter({ has: page.locator(".game-score") }).first(),
    [".game-score", ".game-status"],
  );
  expect(scoreOffset).toBeCloseTo((headline - status) / 2, 1);
  expect(statusOffset - scoreOffset).toBeCloseTo(status - headline, 1);
});

test("the Games tab bolds each winner, and shows a club that's out as any other", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const findSide = (away, home, side) =>
    page
      .locator("#seasonGames .game-day:not(.is-today) .game-row")
      .filter({ hasText: away })
      .filter({ hasText: home })
      .locator(`.game-side.${side}`);

  const winnerStillIn = findSide("Brewers", "Phillies", "away").locator(".team-name");
  const loserStillIn = findSide("Brewers", "Phillies", "home").locator(".team-name");
  const winnerOut = findSide("Nationals", "Tigers", "away").locator(".team-name");
  const loserOut = findSide("Nationals", "Tigers", "home");

  const team = await readRole(page, "team");
  await expect(winnerStillIn).toHaveCSS("font-weight", String(team.weight + 150));
  await expect(winnerStillIn).toHaveCSS("color", await readColor(page, "--ink"));
  await expect(loserStillIn).toHaveCSS("font-weight", String(team.weight));
  await expect(loserStillIn).toHaveCSS("color", await readColor(page, "--ink"));
  await expect(winnerOut).toHaveCSS("font-weight", String(team.weight + 150));
  await expect(winnerOut).toHaveCSS("color", await readColor(page, "--ink"));
  await expect(loserOut.locator(".team-name")).toHaveCSS("color", await readColor(page, "--ink"));
  await expect(loserOut.locator(".dot")).toHaveCSS("opacity", "1");
});

test("a final's losing score is dimmed, a step lighter than the winner's in Ball but not in Night Game, at the same width in both", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const score = page
    .locator("#seasonGames .game-day:not(.is-today) .game-row")
    .filter({ hasText: "Nationals" })
    .filter({ hasText: "Tigers" })
    .locator(".game-score");
  const readScore = () =>
    score.evaluate((element) => {
      const lost = /** @type {Element} */ (element.querySelector(".lost"));
      return {
        winner: getComputedStyle(element).fontWeight,
        loser: getComputedStyle(lost).fontWeight,
        width: lost.getBoundingClientRect().width,
      };
    });
  const scoreWeight = (await readRole(page, "stat-large")).weight;

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(score.locator(".lost")).toHaveCSS("color", await readColor(page, "--ink-dim"));
  const ball = await readScore();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(score.locator(".lost")).toHaveCSS("color", await readColor(page, "--ink-dim"));
  const nightGame = await readScore();

  expect(ball).toEqual({ ...ball, winner: String(scoreWeight), loser: String(scoreWeight - 100) });
  expect(nightGame).toEqual({
    ...nightGame,
    winner: String(scoreWeight),
    loser: String(scoreWeight),
  });
  expect(nightGame.width).toBeCloseTo(ball.width, 2);
});

test("on a wide screen, the Games strip and list sit in the middle of the page", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const pageMiddle = page.viewportSize().width / 2;
  for (const locator of [
    page.locator("#seasonGames .day-bar"),
    page.locator("#seasonGames .game-day.is-today .game-row").first(),
  ]) {
    const box = await locator.boundingBox();
    expect(Math.abs(box.x + box.width / 2 - pageMiddle)).toBeLessThanOrEqual(1);
  }
});

test("on a wide screen, the strip, its line, and a held day's line stop at the column's edges, eleven whole days filling it, with the month and Today 0.5px in from its edges", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page, { isWholeSeason: true });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames")).toHaveAttribute("data-held-arrived", "true");

  const edges = await readStripEdges(page);
  const heading = await page
    .locator("#seasonGames .day-heading")
    .first()
    .evaluate((element) => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right };
    });
  for (const part of [edges.line, edges.strip, heading]) {
    expect(part.left).toBeCloseTo(edges.column.left, 1);
    expect(part.right).toBeCloseTo(edges.column.right, 1);
  }
  expect(edges.wholeDays).toBe(11);
  expect(edges.firstDayLeft).toBeCloseTo(edges.strip.left, 0);
  expect(edges.lastDayRight).toBeCloseTo(edges.strip.right, 0);
  expect(edges.monthLeft - edges.column.left).toBeCloseTo(0.5, 1);
  expect(edges.column.right - edges.todayRight).toBeCloseTo(0.5, 1);
});
