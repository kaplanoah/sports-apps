import {
  test,
  expect,
  openApp,
  openSettings,
  buildFixtureSnapshot,
  buildSnapshotWithStarters,
  chooseSeason,
  EVENING_FIXTURE,
  matchPath,
  readKept,
  SEASON_2025,
  buildSeasonRecord,
  PITCHER_SIDES,
  PLAYER_DOCS,
  RECORDED_HIGHLIGHTS,
  ROSTER_DOCS,
} from "./harness.mjs";
import { listAnimations } from "../../../../tests/browser/animations.mjs";
import { listFontsNotPreloaded } from "../../../../tests/browser/font-loads.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText, measureFieldFace } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import {
  listTapFlashes,
  listTapsOffButtons,
  listTouchHoverRules,
} from "../../../../tests/browser/tap-states.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { readStripEdges } from "../../../../tests/browser/day-strip-edges.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PLAYOFF_FIELD_2026 = [
  "Rays",
  "Guardians",
  "Rangers",
  "Yankees",
  "Red Sox",
  "White Sox",
  "Brewers",
  "Dodgers",
  "Braves",
  "Padres",
  "Cubs",
  "Phillies",
];

test("the page's font comes from its own server, in every weight from one file", async ({
  page,
}) => {
  const fontRequests = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontRequests.push(new URL(request.url()).pathname);
  });
  await openApp(page);

  const loadedWeights = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter(
        (font) => font.family.replaceAll('"', "") === "Chivo Mono" && font.status === "loaded",
      )
      .map((font) => font.weight);
  });
  expect(loadedWeights).toContain("100 900");
  expect(fontRequests).toEqual(["/fonts/chivo-mono-latin.woff2"]);
});

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

test("each day's heading is a band of the page's color, ending in a line, its capitals on the type scale", async ({
  page,
}) => {
  await openSeasonGames(page);
  const heading = page.locator('#seasonGames .listed-day[data-day="2026-09-23"] .day-heading');
  const pageColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await expect(heading).toHaveCSS("background-color", pageColor);
  await expect(heading).toHaveCSS("font-size", "13px");
  await expect(heading).toHaveCSS("text-transform", "uppercase");
  await expect(heading).toHaveCSS("box-shadow", /0px 1px 0px 0px$/);
  await expect(
    page.locator('#seasonGames .listed-day[data-day="2026-09-24"] .day-heading'),
  ).toHaveCSS("color", "rgb(244, 193, 92)");
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
  const describeGame = (start) => (game) => ({ state: "pre", start, postseason: true, ...game });
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
  await expect(labels.last()).toHaveCSS("color", await readColor(page, "--gold"));
  await expect(labels.last().locator(".series-count")).toHaveCSS(
    "color",
    await readColor(page, "--gold"),
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
  await expect(race).toHaveCSS("color", await readColor(page, "--gold"));
  await expect(race).toHaveCSS("font-weight", "400");
});

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

const PHONE = { width: 390, height: 844 };
const WIDE_SCREEN = { width: 1800, height: 900 };
const LAPTOP = { width: 1280, height: 800 };

const CREAM = "rgb(241, 234, 212)";
const TAUPE = "rgb(153, 139, 125)";
const GOLD = "rgb(244, 193, 92)";

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

  await expect(winnerStillIn).toHaveCSS("font-weight", "550");
  await expect(winnerStillIn).toHaveCSS("color", CREAM);
  await expect(loserStillIn).toHaveCSS("font-weight", "400");
  await expect(loserStillIn).toHaveCSS("color", CREAM);
  await expect(winnerOut).toHaveCSS("font-weight", "550");
  await expect(winnerOut).toHaveCSS("color", CREAM);
  await expect(loserOut.locator(".team-name")).toHaveCSS("color", CREAM);
  await expect(loserOut.locator(".dot")).toHaveCSS("opacity", "1");
});

test("the bracket shows an eliminated club in taupe, without a line through its name", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await chooseSeason(page, "2025");

  const eliminated = page
    .locator(".matchup-row.eliminated .team-name")
    .filter({ hasText: "Mariners" })
    .first();
  await expect(eliminated).toHaveCSS("color", TAUPE);
  await expect(eliminated).toHaveCSS("text-decoration-line", "none");
  expect(await listLowContrastText(page)).toEqual([]);
});

test("a club's seed is labeled beside its card only where it enters the bracket: its Wild Card slot or its bye's Division Series slot", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await chooseSeason(page, "2025");
  const bracket = page.locator("#bracketWrap");
  const readLabels = (round, club) =>
    bracket.locator(`.box[data-round="${round}"]`).filter({ hasText: club }).locator(".seed-label");

  await expect(readLabels("WC", "Yankees")).toHaveText(["5 seed", "4 seed"]);
  await expect(readLabels("DS", "Blue Jays")).toHaveText(["1 seed"]);
  await expect(readLabels("CS", "Blue Jays")).toHaveCount(0);
  await expect(readLabels("WS", "Dodgers")).toHaveCount(0);
  await expect(bracket.locator(".seed-label")).toHaveCount(12);
  await expect(bracket.locator(".matchup-row .seed-label")).toHaveCount(0);

  const division = bracket.locator('.box[data-round="DS"]').filter({ hasText: "Blue Jays" });
  const byeRow = await division
    .locator(".matchup-row")
    .filter({ hasText: "Blue Jays" })
    .boundingBox();
  const label = await division.locator(".seed-label").boundingBox();
  const card = await division.locator(".series").boundingBox();
  expect(label.x + label.width).toBeLessThanOrEqual(card.x);
  expect(Math.abs(label.y + label.height / 2 - (byeRow.y + byeRow.height / 2))).toBeLessThan(1);
});

test("once a series' first game starts, both clubs' scores show 0, at the height of an empty score", async ({
  page,
}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  snapshot.series.AL_WC1.started = true;
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const scores = page.locator("#bracketWrap .nscore");
  const started = page
    .locator("#bracketWrap .series")
    .filter({ has: page.locator(".nscore", { hasText: "0" }) });

  await expect(started.locator(".nscore")).toHaveText(["0", "0"]);
  await expect(scores.filter({ hasText: "0" })).toHaveCount(2);
  const filled = await scores.filter({ hasText: "0" }).first().boundingBox();
  const empty = await scores.filter({ hasText: /^$/ }).first().boundingBox();
  expect(empty.height).toBe(filled.height);
});

test("a series winner's digit sits higher in its gold box than a dark box's, in a box of the same height", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await chooseSeason(page, "2025");
  const wildCard = page.locator("#bracketWrap .series").filter({ hasText: "Reds" });
  const readScore = (club) =>
    wildCard.locator(".matchup-row").filter({ hasText: club }).locator(".nscore");

  await expect(readScore("Dodgers")).toHaveCSS("padding-top", "2.75px");
  await expect(readScore("Reds")).toHaveCSS("padding-top", "3.5px");
  const gold = await readScore("Dodgers").boundingBox();
  const dark = await readScore("Reds").boundingBox();
  expect(gold.height).toBe(dark.height);
});

test("on a phone, the bracket's round dots sit just above the tab bar and follow its scroll", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const dots = page.locator("#bracketWrap .round-dots");
  await expect(dots.locator("[data-round]")).toHaveCount(4);
  await expect(dots.locator(".on")).toHaveCount(1);
  const dotsBox = await dots.boundingBox();
  const bar = await page.locator("#tabBar").boundingBox();
  expect(bar.y - (dotsBox.y + dotsBox.height)).toBeGreaterThan(0);
  expect(bar.y - (dotsBox.y + dotsBox.height)).toBeLessThanOrEqual(8);

  const scroller = page.locator("#bracketWrap .tree-scroll");
  await scroller.evaluate((tree) => tree.scrollTo({ left: 0, behavior: "instant" }));
  await expect(dots.locator('[data-round="WC"]')).toHaveClass("on");
  await scroller.evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));
  await expect(dots.locator('[data-round="WS"]')).toHaveClass("on");
});

test("on a wide screen, the whole bracket shows without round dots", async ({ page }) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  await expect(page.locator("#bracketWrap .tree-scroll")).not.toHaveClass(/stacked/);
  await expect(page.locator("#bracketWrap .round-dots")).toHaveCount(0);
});

test("a stacked bracket that fits the screen's width has no round dots and nothing to scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  const scroller = page.locator("#bracketWrap .tree-scroll");
  const dots = page.locator("#bracketWrap .round-dots");
  const canScroll = () => scroller.evaluate((tree) => tree.scrollWidth > tree.clientWidth);
  await expect(scroller).toHaveClass(/stacked/);
  await expect(dots).toHaveCount(0);
  expect(await canScroll()).toBe(false);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(dots).toHaveCount(1);
  expect(await canScroll()).toBe(true);

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(dots).toHaveCount(0);
  expect(await canScroll()).toBe(false);
});

test("on a phone, the bracket stacks the AL above the NL, each running left to right into the World Series", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const findCard = (round) => bracket.locator(".box").filter({ hasText: round });
  const readLeft = async (round) => (await findCard(round).first().boundingBox()).x;

  const al = bracket.locator(".league-head.al");
  const nl = bracket.locator(".league-head.nl");
  await expect(al).toHaveText("American League");
  await expect(nl).toHaveText("National League");
  await expect(al).toHaveCSS("text-align", "left");
  const alTop = (await al.boundingBox()).y;
  const nlTop = (await nl.boundingBox()).y;
  expect(alTop).toBeLessThan(nlTop);

  const worldSeries = await bracket
    .locator(".box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(await readLeft("Wild Card")).toBeLessThan(await readLeft("Division Series"));
  expect(await readLeft("Division Series")).toBeLessThan(await readLeft("Championship Series"));
  expect(await readLeft("Championship Series")).toBeLessThan(worldSeries.x);

  const alcs = await findCard("Championship Series").nth(0).boundingBox();
  const nlcs = await findCard("Championship Series").nth(1).boundingBox();
  expect(alcs.y).toBeGreaterThan(alTop);
  expect(alcs.y).toBeLessThan(nlTop);
  expect(nlcs.y).toBeGreaterThan(nlTop);
  expect(worldSeries.y).toBeGreaterThan(alcs.y);
  expect(worldSeries.y).toBeLessThan(nlcs.y);
});

const WILD_CARD_SERIES = ["AL_WC1", "AL_WC2", "NL_WC1", "NL_WC2"];

for (const width of [360, 390]) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("every card's next game fits on one line under it", async ({ page }) => {
      await openApp(page);
      const notes = page.locator("#bracketWrap .card-note");
      await expect(notes.first()).toBeVisible();
      const lineCounts = await notes.evaluateAll((elements) =>
        elements.map((note) => {
          const range = document.createRange();
          range.selectNodeContents(note);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.bottom))).size;
        }),
      );
      expect(lineCounts.length).toBeGreaterThan(0);
      expect(lineCounts.filter((count) => count !== 1)).toEqual([]);
    });
  });
}

test("under a card whose game is under way, the score, inning, and outs show instead of the next game", async ({
  page,
}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const start = "2026-09-24T23:08:00Z";
  for (const seriesId of WILD_CARD_SERIES)
    snapshot.series[seriesId].next = { at: start, date: "2026-09-24", tbd: false, game: 1 };
  snapshot.slate.today.games.push(
    {
      away: "NYY",
      home: "BOS",
      state: "live",
      start,
      score: [2, 3],
      inning: 4,
      half: "top",
      outs: 1,
    },
    { away: "PHI", home: "ATL", state: "live", start, score: [4, 1], inning: 5, half: "middle" },
    {
      away: "SD",
      home: "CHC",
      state: "live",
      start,
      score: [1, 1],
      inning: 6,
      half: "top",
      outs: 2,
      delay: "Delayed: Rain",
    },
  );
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const notes = page.locator("#bracketWrap .card-note");

  const batting = notes.filter({ hasText: /^3-2 Top 4th$/ });
  await expect(batting).toHaveCount(1);
  await expect(batting).toHaveCSS("color", await readColor(page, "--copper-ink"));
  await expect(batting).toHaveCSS("font-style", "normal");
  await expect(batting.getByRole("img", { name: "1 out" })).toBeVisible();
  await expect(batting.locator(".out-light")).toHaveCount(2);
  await expect(batting.locator(".out-light.on")).toHaveCount(1);
  const [score, inning, lights] = await Promise.all(
    [
      batting.locator(".live-part").nth(0),
      batting.locator(".live-part").nth(1),
      batting.locator(".out-lights"),
    ].map((part) => part.boundingBox()),
  );
  const spaceBeforeInning = inning.x - (score.x + score.width);
  const spaceBeforeLights = lights.x - (inning.x + inning.width);
  expect(spaceBeforeLights).toBeGreaterThan(spaceBeforeInning);
  const betweenHalves = notes.filter({ hasText: /^4-1 Mid 5th$/ });
  await expect(betweenHalves).toHaveCount(1);
  await expect(betweenHalves.locator(".out-light")).toHaveCount(0);
  const delayed = notes.filter({ hasText: /^1-1 Delayed: Rain$/ });
  await expect(delayed).toHaveCount(1);
  await expect(delayed).toHaveCSS("color", await readColor(page, "--gold"));
  await expect(delayed.locator(".out-light")).toHaveCount(0);
  await expect(notes.filter({ hasText: /^Today\u20227:08\sPM$/ })).toHaveCount(1);
});

// The page's clock reads 8:44:43 PM Eastern.
const buildFirstPitchSnapshot = (start, slateGame = {}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  for (const seriesId of WILD_CARD_SERIES)
    snapshot.series[seriesId].next = { at: start, date: "2026-09-24", tbd: false, game: 1 };
  snapshot.slate.today.games.push({ away: "NYY", home: "BOS", state: "pre", start, ...slateGame });
  return snapshot;
};

test("in the half hour before first pitch, a card counts down the minutes on the viewer's clock", async ({
  page,
}) => {
  const snapshot = buildFirstPitchSnapshot("2026-09-25T01:02:00Z");
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const notes = page.locator("#bracketWrap .card-note");

  const countdown = notes.filter({ hasText: /^First pitch in 18 min$/ });
  await expect(countdown).toHaveCount(1);
  await expect(countdown).toHaveCSS("color", await readColor(page, "--copper-ink"));
  await expect(notes.filter({ hasText: /^Today\u20229:02\sPM$/ })).toHaveCount(3);

  await page.clock.runFor(60 * 1000);
  await expect(notes.filter({ hasText: /^First pitch in 17 min$/ })).toHaveCount(1);
});

test("redrawing the bracket each minute keeps keyboard focus on it", async ({ page }) => {
  await openApp(page);
  const bracket = page.getByRole("region", { name: "Bracket" });
  await bracket.focus();

  await page.clock.runFor(60 * 1000);
  await expect(bracket).toBeFocused();
});

const readColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

test("on a phone, the World Series card scrolls all the way to the middle of the screen", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const scroller = page.locator(".tree-scroll");
  await expect(scroller).toBeVisible();
  await scroller.evaluate(
    (element) =>
      new Promise((resolve) => {
        element.addEventListener("scrollend", resolve, { once: true });
        element.scrollLeft = element.scrollWidth;
      }),
  );

  const worldSeries = await page
    .locator("#bracketWrap .box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(Math.abs(worldSeries.x + worldSeries.width / 2 - PHONE.width / 2)).toBeLessThan(2);
  expect((await readBracketFit(page)).pageOverflow).toBe(0);
});

test("on a phone, the bracket opens on the earliest round still playing, and swipes either way", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  const scroller = page.locator(".tree-scroll");
  await expect(page.locator('.box[data-round="WC"]').first()).toBeInViewport();
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(0);

  await chooseSeason(page, "2025");
  const worldSeries = page.locator('.box[data-round="WS"]');
  await expect(worldSeries).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.box[data-round="WC"]').first()).not.toBeInViewport();

  await scroller.evaluate((element) => (element.scrollLeft = 0));
  await expect(page.locator('.box[data-round="WC"]').first()).toBeInViewport();
  await expect(worldSeries).not.toBeInViewport();

  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Bracket" }).click();
  await expect(worldSeries).toBeInViewport({ ratio: 1 });
});

test("on a phone, a bracket opening on the Division Series keeps its byes' seed labels in view", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  for (const id of ["AL_WC1", "AL_WC2", "NL_WC1", "NL_WC2"])
    snapshot.series[id] = { winsA: 2, winsB: 0, started: true };
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });

  const division = page.locator('.box[data-round="DS"]').first();
  await expect(division.locator(".series")).toBeInViewport({ ratio: 1 });
  await expect(division.locator(".seed-label")).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.box[data-round="WC"] .series').first()).not.toBeInViewport({
    ratio: 1,
  });
});

test("on a small tablet, which the app treats as a phone, the bracket opens on the round still playing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await chooseSeason(page, "2025");

  await expect(page.locator('.box[data-round="WS"]')).toBeInViewport({ ratio: 1 });
  expect(
    await page.locator(".tree-scroll").evaluate((scroller) => scroller.scrollLeft),
  ).toBeGreaterThan(0);
});

test("wider than a phone, the stacked bracket starts at the Wild Card with every seed in view, whatever round is still playing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  const scroller = page.locator(".tree-scroll");
  const readScroll = () => scroller.evaluate((element) => element.scrollLeft);
  const expectSeedsInView = async () => {
    await expect(page.locator(".seed-label")).toHaveCount(12);
    for (const label of await page.locator(".seed-label").all())
      await expect(label).toBeInViewport();
  };
  await expectSeedsInView();
  expect(await readScroll()).toBe(0);

  await chooseSeason(page, "2025");
  await expect(page.locator('.box[data-round="WS"]').filter({ hasText: "Dodgers" })).toHaveCount(1);
  await expectSeedsInView();
  expect(await readScroll()).toBe(0);
});

const readStackedSpaces = (page) =>
  page.evaluate(() => {
    const readBox = (element) => element.getBoundingClientRect();
    const header = readBox(document.querySelector("header.top"));
    const line = readBox(document.querySelector("#bracketWrap .league-head.al"));
    const [upperCard, lowerCard] = [...document.querySelectorAll("#bracketWrap .box")].map(readBox);
    return {
      aboveLeague: line.top - header.bottom,
      belowLine: upperCard.top - line.bottom,
      betweenRows: lowerCard.top - upperCard.bottom - 22,
    };
  });

test("on a phone too short for the bracket, its spaces are at their tightest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();

  expect(await readStackedSpaces(page)).toEqual({
    aboveLeague: 13,
    belowLine: 5,
    betweenRows: 6,
  });
});

test("on a taller phone, every space in the bracket grows by the same factor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();

  const { aboveLeague, belowLine, betweenRows } = await readStackedSpaces(page);
  const growth = betweenRows / 13;
  expect(growth).toBeGreaterThan(1.5);
  expect(belowLine / 11).toBeCloseTo(growth, 0);
  expect(aboveLeague / 13).toBeCloseTo(growth, 0);
});

const readCardTops = (page, round) =>
  page
    .locator("#bracketWrap .box")
    .filter({ hasText: round })
    .evaluateAll((boxes) => boxes.map((box) => box.getBoundingClientRect().top));

test("on a phone, each wild card card sits level with the division card it feeds", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await expect(page.locator("#bracketWrap .bracket-stage")).toBeVisible();

  const wildCardTops = await readCardTops(page, "Wild Card");
  const divisionTops = await readCardTops(page, "Division Series");

  expect(wildCardTops).toHaveLength(4);
  expect(wildCardTops.toSorted()).toEqual(divisionTops.toSorted());
});

test("on a phone, a league's name stays at the left while its line scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const name = page.locator("#bracketWrap .league-head.al .league-name");
  await expect(name).toBeVisible();
  const restingLeft = (await name.boundingBox()).x;

  await page.locator(".tree-scroll").evaluate((scroller) => (scroller.scrollLeft = 300));

  await expect.poll(async () => (await name.boundingBox()).x).toBe(restingLeft);
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

test("on a wide screen, the AL and NL face each other across the World Series", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const championships = bracket.locator(".box").filter({ hasText: "Championship Series" });
  await expect(championships).toHaveCount(2);

  const alcs = await championships.nth(0).boundingBox();
  const nlcs = await championships.nth(1).boundingBox();
  const worldSeries = await bracket
    .locator(".box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(alcs.x).toBeLessThan(worldSeries.x);
  expect(worldSeries.x).toBeLessThan(nlcs.x);
  expect(alcs.y).toBe(worldSeries.y);
  await expect(
    bracket.locator(".series.world .bestof span").filter({ hasText: "World Series" }),
  ).toHaveCSS("color", GOLD);

  const divisions = bracket.locator(".box").filter({ hasText: "Division Series" });
  const upperDivision = await divisions.nth(0).boundingBox();
  const lowerDivision = await divisions.nth(1).boundingBox();
  const noteAndGap = lowerDivision.y - (upperDivision.y + upperDivision.height);
  expect(noteAndGap).toBe(80);
});

test("on a wide screen, each league's seed labels sit on its outer side", async ({ page }) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const findOuterGap = async (index) => {
    const wildCard = bracket.locator('.box[data-round="WC"]').nth(index);
    const card = await wildCard.locator(".series").boundingBox();
    const label = await wildCard.locator(".seed-label").first().boundingBox();
    return { before: card.x - (label.x + label.width), after: label.x - (card.x + card.width) };
  };

  expect((await findOuterGap(0)).before).toBeGreaterThan(0);
  expect((await findOuterGap(2)).after).toBeGreaterThan(0);
  const pageOverflow = await page.evaluate(
    () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
  );
  expect(pageOverflow).toBe(0);
});

test("on a wide screen, a centered league bar spans each league's three columns and its seeds' labels", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const findBox = (round, index) =>
    bracket.locator(".box").filter({ hasText: round }).nth(index).boundingBox();
  const al = bracket.locator(".league-head.al");
  const nl = bracket.locator(".league-head.nl");
  await expect(al).toHaveText("American League");
  await expect(nl).toHaveText("National League");
  await expect(al).toHaveCSS("text-align", "center");
  await expect(nl).toHaveCSS("text-align", "center");

  const alBar = await al.boundingBox();
  const nlBar = await nl.boundingBox();
  const stage = await bracket.locator(".bracket-stage").boundingBox();
  const alWildCard = await findBox("Wild Card", 0);
  const alcs = await findBox("Championship Series", 0);
  const nlcs = await findBox("Championship Series", 1);
  const alLabel = await bracket.locator(".seed-labels.left").first().boundingBox();
  const nlLabel = await bracket.locator(".seed-labels.right").last().boundingBox();
  expect(alBar.y).toBe(nlBar.y);
  expect(alBar.x).toBe(stage.x);
  expect(alBar.x).toBeLessThanOrEqual(alLabel.x);
  expect(alBar.x + alBar.width).toBe(alcs.x + alcs.width);
  expect(nlBar.x).toBe(nlcs.x);
  expect(nlBar.x + nlBar.width).toBe(stage.x + stage.width);
  expect(nlBar.x + nlBar.width).toBeGreaterThanOrEqual(nlLabel.x + nlLabel.width);
  expect(alWildCard.y - (alBar.y + alBar.height)).toBe(18);
});

test("narrowing the window until the whole bracket can't show switches to the stacked bracket", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const al = page.locator("#bracketWrap .league-head.al");
  const nl = page.locator("#bracketWrap .league-head.nl");
  await expect(al).toHaveCSS("text-align", "center");
  expect((await al.boundingBox()).y).toBe((await nl.boundingBox()).y);

  await page.setViewportSize(LAPTOP);

  await expect(al).toHaveCSS("text-align", "left");
  expect((await al.boundingBox()).y).toBeLessThan((await nl.boundingBox()).y);
});

test("on a laptop too narrow for the whole bracket, the stacked bracket fills down to the page's bottom space", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head")).toHaveCount(2);

  const { stageBottom, spaceBottom } = await page.evaluate(() => ({
    stageBottom: document.querySelector(".bracket-stage").getBoundingClientRect().bottom + scrollY,
    spaceBottom: innerHeight - parseFloat(getComputedStyle(document.body).paddingBottom),
  }));
  expect(spaceBottom - stageBottom).toBeGreaterThanOrEqual(0);
  expect(spaceBottom - stageBottom).toBeLessThan(8);
  expect(await readCardTops(page, "Wild Card")).toEqual(
    await readCardTops(page, "Division Series"),
  );
});

test("renders the bracket, standings and stamp from the season's record the Worker saved", async ({
  page,
}) => {
  const app = await openApp(page);

  const bracket = page.locator("#bracketWrap");
  for (const club of PLAYOFF_FIELD_2026) await expect(bracket).toContainText(club);
  const stampLines = page.locator("#stamp > span");
  await expect(stampLines.first()).toHaveText(/^NOW\s*Reds @ Braves 5-5 in the 5th/);
  await expect(stampLines.nth(1)).toHaveText(/^Next first pitch /);

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standingsWrap .div-block")).toHaveCount(8);
  await expect(page.locator("#standingsWrap")).toContainText("AL East");
  expect(app.countSnapshotRequests()).toBe(0);
});

test("standings open on each league's playoff field, and every table lines up", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();

  const fields = page.locator("#standingsWrap .field-grid .div-block");
  await expect(fields).toHaveCount(2);
  await expect(fields.first()).toContainText("AL Playoff Field");
  await expect(fields.first().locator(".wild-card-head")).toHaveText(/Wild cards/);

  const readHeights = (selector) =>
    page
      .locator(selector)
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  const tableHeights = await readHeights("#standingsWrap .div-grid table.st");
  expect(tableHeights).toHaveLength(6);
  expect(new Set(tableHeights).size).toBe(1);
  expect(new Set(await readHeights("#standingsWrap .div-title")).size).toBe(1);
});

test("the standings show each club's game under way, and a delay in gold", async ({ page }) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const delayedGame = snapshot.slate.today.games.find((game) => game.home === "BOS");
  delayedGame.delay = "Delayed: Rain";
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  await page.getByRole("tab", { name: "Standings" }).click();
  const cells = page.locator("#standingsWrap td.next-cell");

  const leading = cells.filter({ hasText: /^Up 3 @ NYY in the 6th$/ });
  await expect(leading).not.toHaveCount(0);
  await expect(leading.first()).toHaveCSS("color", await readColor(page, "--copper-ink"));
  await expect(cells.filter({ hasText: /^Down 3 vs TB in the 6th$/ })).not.toHaveCount(0);
  const delayed = cells.filter({ hasText: /^Down 1 vs CLE \u2014 Delayed: Rain$/ });
  await expect(delayed).not.toHaveCount(0);
  await expect(delayed.first()).toHaveCSS("color", GOLD);
});

test("the leagues' standings sit side by side only when a game under way fits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const fields = page.locator("#standingsWrap .field-grid .div-block");
  const readTops = () =>
    fields.evaluateAll((blocks) => blocks.map((block) => block.getBoundingClientRect().top));

  await expect.poll(async () => new Set(await readTops()).size).toBe(1);
  const liveCells = page.locator("#standingsWrap td.next-cell.live");
  await expect(liveCells).not.toHaveCount(0);
  const clippedCount = await liveCells.evaluateAll(
    (cells) => cells.filter((cell) => cell.scrollWidth > cell.clientWidth).length,
  );
  expect(clippedCount).toBe(0);

  await page.setViewportSize({ width: 1399, height: 900 });
  await expect.poll(async () => new Set(await readTops()).size).toBe(2);
});

test("says when live scores can't be reached, and shows them once the Worker has them", async ({
  page,
}) => {
  const app = await openApp(page, {
    liveAvailable: false,
    store: { "live/status": { error: "upstream_error", detail: "MLB answered 503", write: "" } },
  });

  await expect(page.locator("#stamp")).toContainText(
    "Couldn't reach live scores. Trying again shortly.",
  );

  await app.updateFromWorker();
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);
  await expect(page.locator("#stamp")).not.toContainText("Couldn't reach live scores");
});

test("while the Worker can't reach MLB, the page says so over the last scores it saved", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);

  await app.writeFromWorker("live/status", {
    error: "upstream_error",
    detail: "MLB Stats API answered 503 for /api/v1/schedule",
    write: "",
    at: "2026-09-25T00:45:00.000Z",
  });

  await expect(page.locator("#stamp")).toContainText(
    "Couldn't reach live scores. Trying again shortly.",
  );
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);
});

test("switching to 2025 shows the finished bracket and its champion from its record", async ({
  page,
}) => {
  const app = await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await expect.poll(() => app.countSeasonReads()).toBe(2);

  await chooseSeason(page, "2025");

  await expect(page.locator("#bracketWrap")).toContainText("Dodgers win the World Series");
  await expect(page.locator("#updates")).toBeHidden();
  expect(app.countSnapshotRequests()).toBe(0);
});

test("warns under the title when MLB stops sending a field", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);

  app.changeSnapshots((snapshot) => ({ ...snapshot, missing: ["wildCardRank"] }));
  await app.updateFromWorker();

  await expect(page.locator("#stamp")).toContainText(
    "MLB stopped sending wildCardRank, so some details may be blank",
  );
  expect(await listStrayPeriods(page)).toEqual([]);
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
});

test("a warning MLB's feed brings eases the header to its new height", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const readAnimations = await listAnimations(page);
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);

  app.changeSnapshots((snapshot) => ({ ...snapshot, missing: ["wildCardRank"] }));
  await app.updateFromWorker();

  await expect(page.locator("#stamp")).toContainText("MLB stopped sending wildCardRank");
  const growth = (await readAnimations()).find(({ element }) => element === "stamp");
  expect(parseFloat(String(growth.last.height))).toBeGreaterThan(
    parseFloat(String(growth.first.height)),
  );
});

test("with no field yet, the bracket says it fills in once MLB projects one", async ({ page }) => {
  await openApp(page, { liveAvailable: false });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  expect(await listStrayPeriods(page)).toEqual([]);
  await expect(page.getByRole("button", { name: "Set the field" })).toHaveCount(0);
  await openSettings(page);
  await expect(page.locator("#rankList")).toHaveText(
    "The ranking fills in once there's a playoff field",
  );
});

test("the bracket and standings scroll from the keyboard, even in Safari", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("region", { name: "Bracket" })).toHaveAttribute("tabindex", "0");

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("region", { name: "AL East standings" })).toHaveAttribute(
    "tabindex",
    "0",
  );
});

test("the ranking can be reordered from the keyboard, and this device keeps it", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);
  await openSettings(page);
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);

  const firstItem = page.locator("#rankList .rank-item").first();
  const movedClubId = await firstItem.getAttribute("data-id");
  await firstItem.locator(".grip").focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
  await expect(page.locator("#rankList .rank-item").nth(1).locator(".grip")).toBeFocused();
  expect(((await readKept(page, "rankings")) ?? {})[2026]?.[1]).toBe(movedClubId);

  await page.reload();
  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
});

test("a ranking reordered in another tab shows in this one", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSeasonReads()).toBe(2);
  await openSettings(page);
  const items = page.locator("#rankList .rank-item");
  await expect(items).toHaveCount(12);
  const order = await items.evaluateAll((shown) => shown.map((item) => item.dataset.id));

  await keepInOtherTab(page, "rankings", { 2026: [...order].reverse() });

  await expect(items.first()).toHaveAttribute("data-id", order.at(-1));
});

test("a stored field short a league says there's no field instead of breaking the page", async ({
  page,
}) => {
  const clubs = ["NYY", "TOR", "SEA", "BOS", "DET", "CLE", "HOU", "LAD", "MIL", "PHI", "CHC", "SD"];
  const teams = Object.fromEntries(
    clubs.map((id, index) => [id, { league: index < 7 ? "AL" : "NL", seed: (index % 6) + 1 }]),
  );
  await openApp(page, {
    liveAvailable: false,
    store: { "seasons/2026": { year: 2026, teams, series: {}, log: [] } },
  });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  await openSettings(page);
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);
});

const buildEmptySeasonSnapshot = (season, springStart) => ({
  ...buildFixtureSnapshot(EVENING_FIXTURE),
  season,
  springStart,
  projected: true,
  teams: {},
  series: {},
  log: [],
  standings: { divisions: {} },
  slate: null,
});

test("the Season picker sets 16px, which an iPhone doesn't zoom into on a tap, and looks as big as the text at --size-glance", async ({
  page,
}) => {
  await openApp(page);
  const picker = page.locator("#yearSel");
  await expect(picker).toHaveCSS("font-size", "16px");
  const widths = await measureFieldFace(picker, "--size-glance");
  expect(widths.field).toBeCloseTo(widths.step, 0);
});

test("the page shows the season the store says is current", async ({ page }) => {
  await openApp(page, {
    now: "2027-02-19T15:00:00Z",
    store: {
      "live/current": { season: 2027 },
      "seasons/2027": buildSeasonRecord(buildEmptySeasonSnapshot(2027, "2027-02-19")),
    },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });

  await expect(page.locator("#yearSel")).toHaveValue("2027");
  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
});

test("a page left open turns over when the store moves on to a new season", async ({ page }) => {
  const app = await openApp(page, {
    now: "2027-02-19T15:00:00Z",
    store: { "live/current": { season: 2026 } },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });
  await expect.poll(() => app.countOpenSockets()).toBe(1);
  await expect(page.locator("#yearSel")).toHaveValue("2026");

  // What the Worker's update saves once spring training has started.
  await app.writeFromWorker("live/current", { season: 2027 });

  await expect(page.locator("#yearSel")).toHaveValue("2027");
  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
});

test("while the store says last year's season is current, the page shows it and asks about no other", async ({
  page,
}) => {
  const app = await openApp(page, {
    now: "2027-02-18T15:00:00Z",
    store: { "live/current": { season: 2026 } },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });
  await expect(page.locator("#yearSel")).toHaveValue("2026");

  await page.clock.fastForward("02:00:00");

  await expect(page.locator("#yearSel")).toHaveValue("2026");
  expect(app.countSnapshotRequests()).toBe(0);
});

test("on a phone, the tabs float at the bottom and stay there while the page scrolls", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const bar = page.locator("#tabBar");
  const resting = await bar.boundingBox();
  const gapBelow = PHONE.height - (resting.y + resting.height);
  expect(gapBelow).toBeGreaterThanOrEqual(16);
  expect(gapBelow).toBeLessThan(32);

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toBeVisible();

  await page.mouse.wheel(0, 800);
  await expect
    .poll(() => bar.boundingBox().then((box) => Math.round(box.y)))
    .toBe(Math.round(resting.y));
});

test("on a phone, a screen reader's bare click still switches tabs", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);

  await page.getByRole("tab", { name: "Games" }).dispatchEvent("click", { detail: 1 });

  await expect(page.getByRole("tab", { name: "Games" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-games")).toBeVisible();
});

test("on a phone, even a page shorter than the screen can scroll", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await expect(page.locator("#view-bracket")).toBeVisible();

  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement.scrollHeight,
    clientHeight: document.scrollingElement.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
});

test("on a phone, tapping the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Standings" }).click();

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("#view-standings")).toBeVisible();
});

test("on a phone, a tap slides the tab bar's pill to its tab, and then nothing animates", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(PHONE);
  await openApp(page);
  const pill = page.locator(".tab-pill");
  // A loaded machine can see the slide end before it looks, so the pill notes each transition.
  await pill.evaluate((element) => {
    const transitions = /** @type {string[]} */ ([]);
    for (const type of ["transitionrun", "transitionend", "transitioncancel"]) {
      element.addEventListener(type, (event) =>
        transitions.push(`${type} ${/** @type {TransitionEvent} */ (event).propertyName}`),
      );
    }
    Object.assign(window, { pillTransitions: transitions });
  });
  const readPillTransitions = () =>
    page.evaluate(() => /** @type {any} */ (window).pillTransitions);

  await page.getByRole("tab", { name: "Games" }).click();

  await expect
    .poll(readPillTransitions)
    .toEqual(["transitionrun transform", "transitionend transform"]);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  const pillBox = await pill.boundingBox();
  const tabBox = await page.getByRole("tab", { name: "Games" }).boundingBox();
  expect(pillBox.x + pillBox.width / 2).toBeCloseTo(tabBox.x + tabBox.width / 2, 0);
  expect(pillBox.height).toBeCloseTo(tabBox.height, 0);
});

const readBracketFit = (page) =>
  page.evaluate(() => {
    const scroller = document.querySelector(".tree-scroll");
    const stage = document.querySelector(".bracket-stage").getBoundingClientRect();
    return {
      stageBottom: stage.bottom + scrollY,
      lowestNoteBottom: Math.max(
        ...[...document.querySelectorAll(".card-note")].map(
          (note) => note.getBoundingClientRect().bottom + scrollY,
        ),
      ),
      dotsTop: document.querySelector(".round-dots").getBoundingClientRect().top + scrollY,
      scrollLeft: scroller.scrollLeft,
      bracketOverflow: scroller.scrollWidth - scroller.clientWidth,
      pageOverflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    };
  });

const expectBracketToFillHeight = async (page) => {
  await expect
    .poll(async () => {
      const { stageBottom, dotsTop } = await readBracketFit(page);
      return dotsTop - stageBottom;
    })
    .toBeGreaterThanOrEqual(8);
  const { stageBottom, lowestNoteBottom, dotsTop } = await readBracketFit(page);
  expect(dotsTop - stageBottom).toBeLessThan(18);
  expect(stageBottom - lowestNoteBottom).toBeLessThan(4);
};

test("on a phone, the bracket fills the height above the tab bar and swipes sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openApp(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
  const { bracketOverflow, pageOverflow } = await readBracketFit(page);
  expect(bracketOverflow).toBeGreaterThan(0);
  expect(pageOverflow).toBe(0);
});

test("on a phone a little short of room, the bracket's spaces shrink so it fits above the round dots", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await openApp(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
  const { belowLine, betweenRows } = await readStackedSpaces(page);
  expect(belowLine).toBeLessThan(11);
  expect(betweenRows).toBeLessThan(13);
  expect(
    await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight),
  ).toBeLessThanOrEqual(1);
});

test("on a phone, the bracket redraws for a new screen height and keeps its sideways scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await openApp(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await page.locator(".tree-scroll").evaluate(
    (scroller) =>
      new Promise((resolve) => {
        scroller.addEventListener("scrollend", resolve, { once: true });
        scroller.scrollLeft = 300;
      }),
  );
  const { scrollLeft } = await readBracketFit(page);
  expect(scrollLeft).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 900 });

  await expectBracketToFillHeight(page);
  expect((await readBracketFit(page)).scrollLeft).toBe(scrollLeft);
});

test("on a phone, a bracket drawn while another tab showed fills the height once shown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.reload();
  await expect(page.locator("#view-standings")).toBeVisible();

  await page.getByRole("tab", { name: "Bracket" }).click();

  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
});

test("clicking the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openApp(page);
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Bracket" }).dispatchEvent("click");

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("the page reopens on the tab it was last on", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();

  await page.reload();

  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toHaveCSS("display", "block");
  await expect(page.locator("#view-bracket")).toHaveCSS("display", "none");
});

test("the page shows the tab it was last on before its modules have loaded", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await page.route(matchPath("/js/app.js"), (route) => route.abort());

  await openApp(page);

  const tab = page.getByRole("tab", { name: "Games" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveClass(/\bactive\b/);
  await expect(page.locator("#view-games")).toHaveCSS("display", "flex");
  await expect(page.locator("#view-bracket")).toHaveCSS("display", "none");
});

test("a tap shows only the page's own states: no gray flash, and no hover left behind", async ({
  page,
}) => {
  await openApp(page);
  expect(await listTapFlashes(page)).toEqual([]);
  expect(await listTouchHoverRules(page)).toEqual([]);
});

// Yesterday, today, and tomorrow, whose games show a past day's, today's, and a coming day's rows.
const SHOWN_DAYS = ["2026-09-23", "2026-09-24", "2026-09-25"];

/**
 * Brings a day to the top of the Games list, as a tap on it in the strip does.
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
async function showDay(page, day) {
  await page.locator(`#seasonGames .day-cell[data-day="${day}"]`).click();
  await expect(
    page.locator(`#seasonGames .listed-day[data-day="${day}"] .game-row`).first(),
  ).toBeInViewport();
}

/**
 * Each state of the Games view's search, shown in turn: its examples, its suggestions as a club's
 * name is typed, and a club's games.
 * @param {import("@playwright/test").Page} page
 */
const listSearchStates = (page) => [
  async () => {
    await page.locator("#seasonGames .go-search").click();
    await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
  },
  async () => {
    await page.locator("#gameSearch .search-input").pressSequentially("Met");
    await expect(page.locator("#gameSearch .search-suggestion").first()).toBeVisible();
  },
  async () => {
    await page.locator("#gameSearch .search-input").press("Enter");
    await expect(page.locator("#gameSearch .game-row").first()).toBeVisible();
  },
];

/**
 * Opens a game's sheet from today's games, and returns a step that shows each of its sections in
 * turn, then a final's Highlights, the last closing the sheet once it has been checked.
 * @param {import("@playwright/test").Page} page
 */
async function showGameSections(page) {
  await showDay(page, "2026-09-24");
  const sheet = page.locator("#gameSheet");
  const showSection = async (name) => {
    await sheet.getByRole("tab", { name }).click();
    await expect(sheet.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
  };
  return [
    async () => {
      await page
        .getByRole("button", { name: "Game details: Astros at Athletics, Thu, Sep 24" })
        .click();
      await expect(sheet.locator(".starters-open")).toBeVisible();
    },
    async () => {
      await showSection("Matchup");
      await expect(sheet.locator("#matchupBody .faceoff")).toBeVisible();
    },
    async () => {
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await showDay(page, "2026-09-23");
      await page
        .getByRole("button", { name: /^Game details: Brewers at Phillies, Wed, Sep 23/ })
        .click();
      await showSection("Highlights");
      await expect(sheet.locator("#highlightsBody .clip-row").first()).toBeVisible();
    },
    async () => {
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    },
  ];
}

// Highlights for a final on the evening's slate, Brewers at Phillies, as MLB cut them for another.
const SEP_23_HIGHLIGHTS = {
  823410: { ...RECORDED_HIGHLIGHTS["849826"], id: "823410" },
};

/** @param {Record<string, any>} fields */
const createNewsStory = (fields) => ({
  url: `https://example.com/${fields.id}`,
  title: `A story about the ${fields.id}`,
  summary: "What happened, in a sentence.",
  author: "A Writer",
  outlet: "ESPN",
  source: "espn",
  publishedAt: "2026-09-24T14:00:00.000Z",
  photo: null,
  teams: ["NYM"],
  ...fields,
});

// A card with a story under its lead, which the News view shows.
const NEWS_DOCS = {
  "news/cards": {
    cards: [
      {
        lead: createNewsStory({ id: "mets", teamFeed: "NYM" }),
        more: [createNewsStory({ id: "league", outlet: "The Athletic", source: "athletic" })],
      },
    ],
  },
};

for (const { screen, viewport } of [
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
  { screen: "a phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("every piece of text keeps to the type scale, in every view", async ({ page }) => {
      await openApp(page, {
        snapshots: { 2026: buildSnapshotWithStarters() },
        store: { ...ROSTER_DOCS, ...PLAYER_DOCS, ...NEWS_DOCS },
        pitchers: PITCHER_SIDES,
        highlights: SEP_23_HIGHLIGHTS,
      });
      await expect(page.locator("#bracketWrap .card-note").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await page.getByRole("tab", { name: "Games" }).click();
      for (const day of SHOWN_DAYS) {
        await showDay(page, day);
        expect(await listOffScaleText(page)).toEqual([]);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listStrayPeriods(page)).toEqual([]);
      }
      for (const state of listSearchStates(page)) {
        await state();
        expect(await listOffScaleText(page)).toEqual([]);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listStrayPeriods(page)).toEqual([]);
      }
      await page.locator("#gameSearch button.search-cancel").click();
      for (const section of await showGameSections(page)) {
        await section();
        expect(await listOffScaleText(page)).toEqual([]);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listStrayPeriods(page)).toEqual([]);
      }
      await page.getByRole("tab", { name: "Standings" }).click();
      await expect(page.locator("table.st tbody tr").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
      await expect(page.locator("#teamSheet .team-stats")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
      await expect(page.locator("#rosterBody .box-table").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      for (const player of ["Steven Kwan", "Tanner Bibee"]) {
        await page.locator("#rosterBody").getByRole("button", { name: player }).click();
        await expect(page.locator("#playerBody .sheet-part").first()).toBeVisible();
        expect(await listOffScaleText(page)).toEqual([]);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listStrayPeriods(page)).toEqual([]);
        await page.locator("#playerSheet").getByRole("button", { name: "Back" }).click();
        await expect(page.locator("#playerSheet")).toBeHidden();
      }
      await page.keyboard.press("Escape");
      await expect(page.locator("#teamSheet")).toBeHidden();
      await page.getByRole("tab", { name: "News" }).click();
      await expect(page.locator(".news-more-title")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await openSettings(page);
      await expect(page.locator("#settingsDialog")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
    });

    test("every spot that looks tappable lands on a button, in every view", async ({ page }) => {
      await openApp(page, {
        snapshots: { 2026: buildSnapshotWithStarters() },
        store: { ...ROSTER_DOCS, ...PLAYER_DOCS, ...NEWS_DOCS },
        pitchers: PITCHER_SIDES,
        highlights: SEP_23_HIGHLIGHTS,
      });
      await expect(page.locator("#bracketWrap .card-note").first()).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      await page.getByRole("tab", { name: "Games" }).click();
      for (const day of SHOWN_DAYS) {
        await showDay(page, day);
        expect(await listTapsOffButtons(page)).toEqual([]);
      }
      for (const state of listSearchStates(page)) {
        await state();
        expect(await listTapsOffButtons(page)).toEqual([]);
      }
      await page.locator("#gameSearch button.search-cancel").click();
      for (const section of await showGameSections(page)) {
        await section();
        expect(await listTapsOffButtons(page)).toEqual([]);
      }
      await page.getByRole("tab", { name: "Standings" }).click();
      await expect(page.locator("table.st tbody tr").first()).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
      await expect(page.locator("#teamSheet .team-stats")).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
      await expect(page.locator("#rosterBody .box-table").first()).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      for (const player of ["Steven Kwan", "Tanner Bibee"]) {
        await page.locator("#rosterBody").getByRole("button", { name: player }).click();
        await expect(page.locator("#playerBody .sheet-part").first()).toBeVisible();
        expect(await listTapsOffButtons(page)).toEqual([]);
        await page.locator("#playerSheet").getByRole("button", { name: "Back" }).click();
        await expect(page.locator("#playerSheet")).toBeHidden();
      }
      await page.keyboard.press("Escape");
      await expect(page.locator("#teamSheet")).toBeHidden();
      await page.getByRole("tab", { name: "News" }).click();
      await expect(page.locator(".news-more-title")).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
      await openSettings(page);
      await expect(page.locator("#settingsDialog")).toBeVisible();
      expect(await listTapsOffButtons(page)).toEqual([]);
    });
  });
}

test("every font the page's views draw with is preloaded", async ({ page }) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await expect(page.locator("#bracketWrap .card-note").first()).toBeVisible();
  await page.getByRole("tab", { name: "Games" }).click();
  for (const day of SHOWN_DAYS) await showDay(page, day);
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("table.st tbody tr").first()).toBeVisible();
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#newsList")).toHaveText("No news yet");

  expect(await listFontsNotPreloaded(page)).toEqual([]);
});

test("Chivo Mono takes its own size at each step: sentences 14.5px, facts and labels 13px", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator("#stamp")).toBeVisible();
  await expect(page.locator("#stamp")).toHaveCSS("font-size", "13px");
  await expect(page.locator("#stamp")).toHaveCSS("line-height", "18px");
  await expect(page.locator("#bracketWrap .card-note").first()).toHaveCSS("font-size", "13px");
});
