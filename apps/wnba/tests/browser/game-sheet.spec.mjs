import {
  test,
  expect,
  openApp,
  openGameSheet,
  findGameButton,
  keepHighlights,
  GAMES,
  matchPath,
  formatRgb,
} from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import {
  recordSheetMotions,
  waitForTimedMotions,
} from "../../../../tests/browser/sheet-motions.mjs";
import { expectShown, expectSteppedAway } from "../../../../tests/browser/sheet-row.mjs";
import { comeBackTo, setHidden } from "../../../../tests/browser/visibility.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { readOklab } from "../../../../shared/page/team-colors.js";
import { TEAMS } from "../../page/js/teams.js";
import { describeBoxScore } from "../../worker/src/box-score.js";

const ACES_AT_FEVER = "Game details: Aces at Fever, First Round Game 2";
const FEVER_AT_ACES = "Game details: Fever at Aces, First Round Game 3";
const VALKYRIES_AT_WINGS = "Game details: Valkyries at Wings, First Round Game 2";
const POLL_LIVE_MS = 15 * 1000;
// A players table's number column, while the names leave it room.
const NUMBER_COLUMN_PX = 52;
// The type scale's smallest size, which the lead chart's words show at with no room above or below.
const SMALLEST_TEXT_PX = 13;
// The room between the band's line and the first part's title, above each later title, below each
// title, below By quarter's, and between a tape's rows.
const FIRST_TITLE_SPACE_PX = 20;
// How far a game's teams sit under the middle of its score or its time, how far its band ends under
// a final's pills or a game's channels, and how far Bonus hangs under its team's record.
const SCORE_TEAMS_DROP_PX = 3;
const TIME_TEAMS_DROP_PX = 4;
const ROOM_BELOW_PILLS_PX = 9;
// The room between a game's title and its teams.
const UNDER_TITLE_PX = 14;
const ROOM_BELOW_CHANNELS_PX = 10;
const BONUS_GAP_PX = 7;
const TITLE_SPACE_ABOVE_PX = 24;
const TITLE_SPACE_BELOW_PX = 14;
const QUARTER_TITLE_SPACE_BELOW_PX = 6;
const TAPE_ROW_SPACE_PX = 12;
// The least room between a team's name, as its font draws it, and the edge of the lead chart's tile.
const NAME_GAP_PX = 4;
// How far, in degrees, the paler bar of the side behind may turn from its team's own hue.
const LARGEST_HUE_TURN = 10;

// Most of these tests are about what a sheet shows, so they skip the eased scrolling between the
// Games lists. The ones about how a sheet moves ask for full motion.
test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * A color's hue in OKLCH, in degrees.
 * @param {string} hex like #1c1c1c
 */
function measureHue(hex) {
  const [, greenRed, blueYellow] = readOklab(hex);
  return (Math.atan2(blueYellow, greenRed) * 180) / Math.PI;
}

/**
 * The color an element's background paints, as hex, whatever form the browser computes it in.
 * @param {import("@playwright/test").Locator} locator
 */
const readPaintedBackground = (locator) =>
  locator.evaluate((element) => {
    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d")
    );
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  });

/** @param {import("@playwright/test").Page} page */
const holdBoxScores = (page) => holdRequests(page, matchPath("/box-score"));

/**
 * Valkyries at Wings, Game 2, under way in the third quarter: the store's game, and the league's
 * box score as it would read then.
 * @param {any} season
 */
function startValkyriesAtWings(season) {
  const game = season.games.find((each) => each.id === "1042600112");
  Object.assign(game, { state: "live", status: "Q3 4:32", period: 3, clock: "4:32" });
  Object.assign(game.away, { score: 74 });
  Object.assign(game.home, { score: 72, isInBonus: true });
  return season;
}
const liveBoxScore = structuredClone(GAMES.boxScores["1042600112"]);
Object.assign(liveBoxScore.game, { gameStatus: 2, period: 3 });

/** @param {import("@playwright/test").Page} page */
function countBoxScoreReads(page) {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/box-score") reads.count += 1;
  });
  return reads;
}

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

test("a game's title is 16.5px at the sheets' title weight, over its series and day at the glance size", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);

  await expect(sheet.locator("#gameTitle")).toHaveCSS("font-size", "16.5px");
  await expect(sheet.locator("#gameTitle")).toHaveCSS("font-weight", "500");
  await expect(sheet.locator("#gameWhen")).toHaveCSS("font-size", "14px");
});

test("only the team rows of By quarter have a line above them, not its heading row", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  const lineScore = sheet.locator(".line-score");
  await expect(lineScore.locator("tbody tr")).toHaveCount(2);

  for (const cell of await lineScore.locator("thead td, thead th").all())
    await expect(cell).toHaveCSS("border-top-width", "0px");
  for (const cell of await lineScore.locator("tbody td, tbody th").all())
    await expect(cell).toHaveCSS("border-top-width", "1px");
});

/**
 * Valkyries at Wings, Game 2, over: the Wings won 108-100 in overtime.
 * @param {any} season
 */
function finishValkyriesAtWings(season) {
  const game = season.games.find((each) => each.id === "1042600112");
  Object.assign(game, { state: "final", status: "Final/OT" });
  Object.assign(game.away, { score: 100 });
  Object.assign(game.home, { score: 108 });
  return season;
}

test("a final's sheet charts the lead through the game under its quarters, and one ESPN has no lead for goes without", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);

  const chart = sheet.locator(".lead-chart");
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    "The Valkyries led by as many as 8, the Wings led by as many as 8",
  );
  await expect(sheet.locator(".sheet-part h3")).toHaveText([
    "By quarter",
    "Lead through the game",
    "Team stats",
    "Top scorers",
  ]);
  await expect(chart.locator(".lead-period")).toHaveText(["Q1", "Q2", "Q3", "Q4", "OT"]);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".line-score tbody tr")).toHaveCount(2);
  await expect(sheet.locator(".sheet-part h3")).toHaveText([
    "By quarter",
    "Team stats",
    "Top scorers",
  ]);
});

test("the lead chart keeps each biggest lead's label on its tile and each team's name just off it", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  const chart = sheet.locator(".lead-chart");
  await expect(chart.locator(".lead-peak-label")).toHaveText(["Valkyries +8", "Wings +8"]);

  const readBox = (/** @type {import("@playwright/test").Locator} */ locator) =>
    locator.evaluateAll((elements) =>
      elements.map((element) => {
        const { top, bottom, left, right } = element.getBoundingClientRect();
        return { top, bottom, left, right };
      }),
    );
  const [tile] = await readBox(chart.locator(".lead-tile"));
  const [awayName, homeName] = await readBox(chart.locator(".lead-side"));
  const labels = await readBox(chart.locator(".lead-peak-label"));
  const [awayPeak, homePeak] = await readBox(chart.locator(".lead-peak"));
  expect(tile.top - awayName.bottom).toBeGreaterThanOrEqual(NAME_GAP_PX);
  expect(homeName.top - tile.bottom).toBeGreaterThanOrEqual(NAME_GAP_PX);
  expect(labels[0].bottom).toBeLessThanOrEqual(awayPeak.top);
  expect(labels[1].top).toBeGreaterThanOrEqual(homePeak.bottom);
  for (const label of labels) {
    expect(label.left).toBeGreaterThanOrEqual(tile.left);
    expect(label.right).toBeLessThanOrEqual(tile.right);
  }
});

for (const { screen, viewport } of [
  { screen: "a phone", viewport: { width: 390, height: 844 } },
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("the lead chart's words show at the type scale's smallest size", async ({ page }) => {
      const app = await openApp(page);
      await app.changeSeason(finishValkyriesAtWings);
      const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
      const words = sheet.locator(
        ".lead-chart :is(.lead-side, .lead-reach, .lead-peak-label, .lead-period)",
      );
      await expect(words).toHaveCount(11);
      const heights = await words.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
      for (const height of heights) expect(height).toBeCloseTo(SMALLEST_TEXT_PX, 0);
    });
  });
}

test("a final's sheet spaces its parts' titles evenly, with By quarter's closer and the stat rows apart", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".lead-peak-label")).toHaveCount(2);
  const layout = await sheet.locator("#gameBody").evaluate((body) => {
    const measure = (/** @type {Element} */ element) => element.getBoundingClientRect();
    const bandBottom = measure(
      /** @type {Element} */ (body.closest(".sheet-page")?.querySelector(".sheet-top")),
    ).bottom;
    const parts = [...body.querySelectorAll(":scope > .sheet-part")].map((part) => {
      const head = measure(/** @type {Element} */ (part.querySelector(".sheet-part-head")));
      const content = measure(/** @type {Element} */ (part.children[1]));
      return {
        title: part.querySelector("h3")?.textContent,
        top: measure(part).top,
        bottom: measure(part).bottom,
        spaceBelow: content.top - head.bottom,
      };
    });
    const rows = [...body.querySelectorAll(".tape-row")].map(measure);
    return {
      firstSpace: parts[0].top - bandBottom,
      parts,
      rowSpaces: rows.slice(1).map((row, index) => row.top - rows[index].bottom),
    };
  });

  expect(layout.firstSpace).toBeCloseTo(FIRST_TITLE_SPACE_PX, 0);
  for (const [index, part] of layout.parts.entries()) {
    if (index > 0)
      expect(part.top - layout.parts[index - 1].bottom).toBeCloseTo(TITLE_SPACE_ABOVE_PX, 0);
    const spaceBelow =
      part.title === "By quarter" ? QUARTER_TITLE_SPACE_BELOW_PX : TITLE_SPACE_BELOW_PX;
    expect(part.spaceBelow).toBeCloseTo(spaceBelow, 0);
  }
  for (const space of layout.rowSpaces) expect(space).toBeCloseTo(TAPE_ROW_SPACE_PX, 0);
});

test("on a phone, a game's teams sit at one height under its title whether it's over or live with a side in the bonus, a little under the score's middle, and a step lower beside a start time, and its band ends a little under a final's pills or a game's channels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await openApp(page);
  await app.changeSeason(startValkyriesAtWings);
  /** @param {string} name */
  const measureBand = async (name) => {
    const sheet = await openGameSheet(page, name);
    await expect(sheet.locator(".faceoff-score")).toBeVisible();
    const band = await sheet.locator(".sheet-top").evaluate((top) => {
      const measure = (/** @type {string} */ selector) =>
        /** @type {Element} */ (top.querySelector(selector)).getBoundingClientRect();
      const lines = [...top.querySelectorAll(".faceoff > *, .pager-tabs:not([hidden])")].map(
        (line) => line.getBoundingClientRect(),
      );
      const bandTop = top.getBoundingClientRect().top;
      const club = measure(".faceoff-side.away .club");
      const record = measure(".faceoff-side.away .faceoff-record");
      const score = measure(".faceoff-score");
      return {
        title: measure("h2").top - bandTop,
        underTitle: measure(".faceoff-slot").top - measure(".sheet-head").bottom,
        teams: club.top - bandTop,
        teamsDrop: (club.top + record.bottom) / 2 - (score.top + score.bottom) / 2,
        roomBelow:
          top.getBoundingClientRect().bottom - Math.max(...lines.map((line) => line.bottom)),
      };
    });
    await page.keyboard.press("Escape");
    return band;
  };

  const final = await measureBand(ACES_AT_FEVER);
  const live = await measureBand(VALKYRIES_AT_WINGS);
  const upcoming = await measureBand(FEVER_AT_ACES);
  for (const band of [live, upcoming]) expect(band.title).toBeCloseTo(final.title, 0);
  for (const band of [final, live, upcoming])
    expect(band.underTitle).toBeCloseTo(UNDER_TITLE_PX, 0);
  expect(live.teams).toBeCloseTo(final.teams, 0);
  expect(upcoming.teams - final.teams).toBeCloseTo(TIME_TEAMS_DROP_PX - SCORE_TEAMS_DROP_PX, 0);
  expect(final.teamsDrop).toBeCloseTo(SCORE_TEAMS_DROP_PX, 0);
  expect(live.teamsDrop).toBeCloseTo(SCORE_TEAMS_DROP_PX, 0);
  expect(upcoming.teamsDrop).toBeCloseTo(TIME_TEAMS_DROP_PX, 0);
  expect(final.roomBelow).toBeCloseTo(ROOM_BELOW_PILLS_PX, 0);
  expect(live.roomBelow).toBeCloseTo(ROOM_BELOW_CHANNELS_PX, 0);
  expect(upcoming.roomBelow).toBeCloseTo(ROOM_BELOW_CHANNELS_PX, 0);
});

test("on a phone, Bonus hangs under its own team's record, at its side's edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await openApp(page);
  await app.changeSeason(startValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  const side = sheet.locator(".faceoff-side.home");
  await expect(side.locator(".bonus")).toHaveText("Bonus");
  const [record, bonus, sideBox] = await Promise.all([
    side.locator(".faceoff-record").boundingBox(),
    side.locator(".bonus").boundingBox(),
    side.boundingBox(),
  ]);

  expect(bonus.y - (record.y + record.height)).toBeCloseTo(BONUS_GAP_PX, 0);
  expect(bonus.x + bonus.width).toBeCloseTo(sideBox.x + sideBox.width, 0);
  await expect(sheet.locator(".faceoff-side.away .bonus")).toHaveCount(0);
});

test("a box score's and a preview's two teams line their numbers up column for column, as wide as they can be", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  for (const [name, player] of [
    [ACES_AT_FEVER, "Caitlin Clark"],
    [FEVER_AT_ACES, "Kelsey Mitchell"],
  ]) {
    const sheet = await openGameSheet(page, name);
    await expect(sheet.getByText(player)).toBeVisible();
    const columns = await sheet.locator("table.players .players-head").evaluateAll((heads) =>
      heads.map((head) =>
        [...head.querySelectorAll("th")].map((cell) => {
          const box = cell.getBoundingClientRect();
          return [Math.round(box.left), Math.round(box.width)];
        }),
      ),
    );
    expect(columns, name).toHaveLength(2);
    expect(columns[1], name).toEqual(columns[0]);
    expect(
      columns[0].slice(1).map(([, width]) => width),
      name,
    ).toEqual(columns[0].slice(1).map(() => NUMBER_COLUMN_PX));
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});

test("a box score's names rise a pixel beside the numbers, a fouled-out chip stays put, and its words center in it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  const name = sheet.locator('table.players th[scope="row"]', { hasText: "Caitlin Clark" });
  await expect(name.locator(".foul-chip")).toHaveText("Fouled out");
  await expect(name).toHaveCSS("top", "-1px");
  await expect(name.locator(".foul-chip")).toHaveCSS("top", "1px");
  await expect(name.locator(".foul-chip-words")).toHaveCSS("top", "-0.5px");
});

test("while the lead loads after the box score, the sheet holds the chart's place, so nothing below it moves as it arrives", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const releaseLead = await holdRequests(page, matchPath("/lead"));
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  const teamStats = sheet.locator(".sheet-part h3", { hasText: "Team stats" });
  await expect(sheet.locator(".line-score .total").last()).toHaveText("108");
  await expect(sheet.locator(".lead-tile.pending")).toBeVisible();
  const before = await teamStats.boundingBox();

  releaseLead();

  await expect(sheet.locator(".lead-peak-label")).toHaveCount(2);
  await expect(sheet.locator(".lead-tile.pending")).toHaveCount(0);
  expect((await teamStats.boundingBox())?.y).toBeCloseTo(before?.y ?? 0, 0);
});

test("each team's side of the lead chart and the team stats takes its color, on each theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  const chart = sheet.locator(".lead-chart");
  const fieldGoals = sheet.locator(".tape-row").first();
  await expect(fieldGoals.locator(".home .tape-bar i")).toHaveClass("lead");

  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme: theme });
    const [awayColor, homeColor] = ["GSV", "DAL"].map((code) =>
      formatRgb(TEAMS[code].chartColors[theme][0]),
    );
    await expect(chart.locator(".lead-side.home")).toHaveCSS("color", homeColor);
    await expect(chart.locator(".lead-peak.home")).toHaveCSS("fill", homeColor);
    await expect(chart.locator(".lead-side.away")).toHaveCSS("color", awayColor);
    await expect(chart.locator(".lead-peak-label.away")).toHaveCSS("color", awayColor);
    await expect(fieldGoals.locator(".home .tape-bar i")).toHaveCSS("background-color", homeColor);
    await expect(fieldGoals.locator(".away .tape-bar i")).not.toHaveCSS(
      "background-color",
      awayColor,
    );
  }
});

test("a side whose color is too light to read as text writes its name and lead on the lead chart in its darker shade, and keeps its color for its dot", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  const chart = sheet.locator(".lead-chart");
  await expect(chart.locator(".lead-peak.home")).toBeVisible();

  const [color, nameColor] = [TEAMS.SEA.chartColors.light[0], TEAMS.SEA.nameColors.light];
  await sheet
    .locator("#gameBody")
    .evaluate(
      (body, [side, name]) =>
        body.setAttribute("style", `--home-light: ${side}; --home-name-light: ${name};`),
      [color, nameColor],
    );
  await expect(chart.locator(".lead-side.home")).toHaveCSS("color", formatRgb(nameColor));
  await expect(chart.locator(".lead-peak-label.home")).toHaveCSS("color", formatRgb(nameColor));
  await expect(chart.locator(".lead-peak.home")).toHaveCSS("fill", formatRgb(color));
});

test("the side behind on a measure gets a paler bar of its own team's hue, on each theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  const behind = sheet.locator(".tape-row").first().locator(".away .tape-bar i");
  await expect(behind).not.toHaveClass("lead");

  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme: theme });
    const teamColor = TEAMS.GSV.chartColors[theme][0];
    await expect(behind).not.toHaveCSS("background-color", formatRgb(teamColor));
    const turn = Math.abs(measureHue(await readPaintedBackground(behind)) - measureHue(teamColor));
    expect(Math.min(turn, 360 - turn)).toBeLessThan(LARGEST_HUE_TURN);
  }
});

test("a team's sheet marks the team in its mark color on each theme, on its curves and its playoff lines, with the playoff field's dot paler than the line's gray", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
  const sheet = page.locator("#teamSheet");
  const ownDot = sheet.locator(".placed-line .own").first();
  const fieldDot = sheet.locator(".placed-line .other").first();
  const curveMark = sheet.locator(".team-ranks .player-curve b").first();
  await expect(curveMark).toBeVisible();
  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme: theme });
    const markColor = formatRgb(TEAMS.NYL.markColors[theme]);
    await expect(ownDot).toHaveCSS("background-color", markColor);
    await expect(curveMark).toHaveCSS("background-color", markColor);
    const [gray, sheetColor] = await fieldDot.evaluate((dot) => {
      const style = getComputedStyle(dot);
      return [style.getPropertyValue("--ink-dim").trim(), style.getPropertyValue("--sheet").trim()];
    });
    const [lightness, grayLightness, sheetLightness] = [
      await readPaintedBackground(fieldDot),
      gray,
      sheetColor,
    ].map((hex) => readOklab(hex)[0]);
    expect(Math.abs(lightness - grayLightness)).toBeGreaterThan(0.05);
    expect(Math.abs(lightness - sheetLightness)).toBeGreaterThan(0.05);
    expect((lightness - grayLightness) * (lightness - sheetLightness)).toBeLessThan(0);
  }
});

/** @param {import("@playwright/test").Page} page */
function countLeadReads(page) {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/lead") reads.count += 1;
  });
  return reads;
}

test("a live game's sheet reads its box score and lead once, then takes what the Worker pushes", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  await app.changeSeason(startValkyriesAtWings);
  const boxScoreReads = countBoxScoreReads(page);
  const leadReads = countLeadReads(page);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".lead-chart")).toBeVisible();
  await expect.poll(() => app.listWatchedPaths()).toContain("games/1042600112");

  await page.clock.runFor(POLL_LIVE_MS * 2);
  expect([boxScoreReads.count, leadReads.count]).toEqual([1, 1]);

  const boxScore = describeBoxScore(liveBoxScore);
  boxScore.away.players[0].points = 41;
  boxScore.away.score += 2;
  await app.saveGameDetails("1042600112", { boxScore, lead: null });
  await expect(sheet.locator("table.players")).toContainText("41");
  await expect(sheet.locator(".lead-chart")).toBeVisible();
});

test("details saved before the sheet's own read don't take a live box score back", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  await app.changeSeason(startValkyriesAtWings);
  const earlier = describeBoxScore(liveBoxScore);
  earlier.away.players[0].points = 41;
  earlier.away.score -= 10;
  await app.saveGameDetails("1042600112", { boxScore: earlier, lead: null });

  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".line-score")).toBeVisible();
  await expect.poll(() => app.listWatchedPaths()).toContain("games/1042600112");
  await page.clock.runFor(POLL_LIVE_MS);

  await expect(sheet.locator("table.players")).not.toContainText("41");
});

for (const { screen, viewport } of [
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
  { screen: "a phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("every piece of text in a live game's row, its sheet, a final's sheet and its Highlights, and a preview keeps to the type scale", async ({
      page,
    }) => {
      const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
      await app.changeSeason(startValkyriesAtWings);
      await keepHighlights(page, app, ACES_AT_FEVER);
      const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
      await expect(page.locator(".bonus").first()).toBeAttached();
      await expect(sheet.locator(".line-score th.now")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator(".clock").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      const final = await openGameSheet(page, ACES_AT_FEVER);
      await expect(final.locator(".line-score")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await final.getByRole("tab", { name: "Highlights" }).click();
      await expect(final.locator("#highlightsBody .clip-row").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(final).toBeHidden();
      const preview = await openGameSheet(page, FEVER_AT_ACES);
      await expect(preview.locator(".meeting-score").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
    });
  });
}

test("a live game's sheet shows its game as it goes, and stops watching it once it closes", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  await app.changeSeason(startValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);

  await expect(sheet.locator(".faceoff .clock")).toHaveText("Q3 4:32");
  await expect(sheet.locator(".faceoff-side.home .bonus")).toHaveText("Bonus");
  await expect(sheet.locator(".line-score th.now")).toHaveText("3");
  await expect(sheet.locator(".sheet-part-head", { hasText: "Team stats" })).toContainText(
    "So far",
  );
  await expect(sheet.locator(".foul-chip")).toHaveText([
    "Fouled out",
    "Fouled out",
    "5 fouls",
    "4 fouls",
  ]);
  await expect.poll(() => app.listWatchedPaths()).toContain("games/1042600112");

  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600112").away.score = 77;
    return season;
  });
  await expect(sheet.locator(".faceoff .score")).toHaveText(/77\s*72/);

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => app.listWatchedPaths()).not.toContain("games/1042600112");
});

test("a game that hasn't started previews the meetings, the season stats, and the leading scorers", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openGameSheet(page, FEVER_AT_ACES);

  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("First Round Game 3");
  await expect(sheet.locator(".faceoff .time")).toHaveText(/^9:00\sPM$/);
  await expect(sheet.locator(".sheet-part-head").first()).toHaveText(
    /Meetings\s*Fever won the season series 2-1/,
  );
  await expect(sheet.locator(".meetings li")).toHaveCount(3);
  await expect(sheet.locator(".meetings li").first()).toHaveText(/Aug 6\s*Aces\s*86-84\s*at Fever/);
  await expect(sheet.locator(".tape-label")).toHaveText([
    "Record",
    "PPG",
    "Opp PPG",
    "Margin",
    /^Road\s+Home$/,
    "Last 10",
  ]);
  await expect(sheet.locator(".tape-note")).toHaveCount(0);
  await expect(sheet.locator(".players tbody tr:not(.players-head)").first()).toHaveText(
    /Kelsey Mitchell\s*24\.7\s*1\.7\s*2\.8/,
  );
});

test("a sheet open on a preview switches to the box score once the game starts", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".meetings")).toBeVisible();

  await app.changeSeason(startValkyriesAtWings);

  await expect(sheet.locator(".line-score")).toBeVisible();
  await expect(sheet.locator(".meetings")).toHaveCount(0);
  await expect(sheet.locator(".faceoff .clock")).toHaveText("Q3 4:32");
});

test("a game the league has no box score for says so, and a preview whose meetings can't load shows the rest", async ({
  page,
}) => {
  await openApp(page, { league: { isScheduleRefused: true } });
  const sheet = await openGameSheet(page, "Game details: Fever at Aces, First Round Game 1");
  await expect(sheet.locator(".sheet-message")).toHaveText(
    "The league hasn't posted a box score for this game yet",
  );
  await expect(sheet.locator("#gameSection [data-retry]")).toHaveCount(0);
  expect(await listStrayPeriods(page)).toEqual([]);
  await sheet.getByRole("button", { name: "Close" }).click();

  const preview = await openGameSheet(page, FEVER_AT_ACES);
  await expect(preview.locator(".retry-message")).toHaveText(
    "Couldn't load this season's meetings",
  );
  await expect(preview.locator(".tape-label")).toHaveCount(6);
  await expect(preview.locator(".players tbody tr:not(.players-head)")).toHaveCount(10);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("a preview's meetings that didn't load read again on a tap on Try again, holding their shape meanwhile", async ({
  page,
}) => {
  await openApp(page);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) => route.fulfill({ status: 502, json: { error: "test" } });
  await page.route(matchPath("/preview"), refuse);
  const preview = await openGameSheet(page, FEVER_AT_ACES);
  const meetings = preview.locator(".sheet-part").first();
  await expect(meetings.locator(".retry-message")).toHaveText(
    "Couldn't load this season's meetings",
  );

  await page.unroute(matchPath("/preview"), refuse);
  const release = await holdRequests(page, matchPath("/preview"));
  await meetings.getByRole("button", { name: "Try again" }).click();
  await expect(meetings.locator(".placeholder").first()).toBeVisible();
  await expect(preview.locator(".players tbody tr:not(.players-head)")).toHaveCount(10);
  release();
  await expect(preview.locator(".meetings li")).toHaveCount(3);
});

test("a final's box score and a preview's meetings open from what the store keeps, with the league down", async ({
  page,
}) => {
  await openApp(page, { isLeagueDownForPage: true });

  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".line-score tbody tr").first()).toHaveText(
    /Aces\s*26\s*17\s*17\s*29\s*89/,
  );
  await sheet.getByRole("button", { name: "Close" }).click();

  const preview = await openGameSheet(page, FEVER_AT_ACES);
  await expect(preview.locator(".meetings li")).toHaveCount(3);
  await expect(preview.locator(".meetings li").first()).toHaveText(
    /Aug 6\s*Aces\s*86-84\s*at Fever/,
  );
});

test("a preview takes the season stats and leading scorers from the store as it changes", async ({
  page,
}) => {
  const app = await openApp(page);
  const sheet = await openGameSheet(page, FEVER_AT_ACES);
  await expect(sheet.locator(".players tbody tr:not(.players-head)")).toHaveCount(10);

  await app.changeSeason((season) => ({ ...season, leaders: [] }));

  await expect(sheet.locator(".sheet-message")).toHaveText("Couldn't load the players' averages");
  await expect(sheet.locator(".tape-label")).toHaveCount(6);
  expect(await listStrayPeriods(page)).toEqual([]);

  await app.changeSeason((season) => ({ ...season, standings: [] }));

  await expect(sheet.locator(".sheet-message")).toHaveText([
    "Couldn't load the standings",
    "Couldn't load the players' averages",
  ]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("a box score the Worker can't load says so over Try again, which holds the box score's shape as it reads it again", async ({
  page,
}) => {
  await openApp(page);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) =>
    route.fulfill({ status: 502, json: { error: "Couldn't read the WNBA: test" } });
  await page.route(matchPath("/box-score"), refuse);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  const block = sheet.locator("#gameBody .retry-block");
  await expect(block.locator(".retry-title")).toHaveText("The server had a problem");
  await expect(block.locator(".retry-next")).toHaveText("Try again to load box score");
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await page.unroute(matchPath("/box-score"), refuse);
  const release = await holdBoxScores(page);
  await block.getByRole("button", { name: "Try again" }).click();
  await expect(sheet.locator("#gameBody .placeholder").first()).toBeVisible();
  release();
  await expect(sheet.locator(".line-score")).toBeVisible();
  await expect(block).toHaveCount(0);
});

test("a box score that didn't load reads again as the phone comes back online", async ({
  page,
}) => {
  await openApp(page);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) => route.fulfill({ status: 502, json: { error: "test" } });
  await page.route(matchPath("/box-score"), refuse);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator("#gameBody .retry-block")).toBeVisible();

  await page.unroute(matchPath("/box-score"), refuse);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(sheet.locator(".line-score")).toBeVisible();
});

test("while its box score loads, the sheet holds the box score's shape, then fills it in", async ({
  page,
}) => {
  await openApp(page);
  const release = await holdBoxScores(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  const body = sheet.locator("#gameBody");

  await expect(body).toHaveAttribute("aria-busy", "true");
  await expect(sheet.locator(".sheet-part-head h3")).toHaveText([
    "By quarter",
    "Team stats",
    "Top scorers",
  ]);
  await expect(sheet.locator(".tape-label")).toHaveCount(8);
  await expect(sheet.locator(".line-score tbody th")).toHaveText(["Aces", "Fever"]);
  await expect(sheet.locator(".players tbody tr:not(.players-head)")).toHaveCount(10);
  await expect(sheet.locator(".tape-value .placeholder")).toHaveCount(16);

  release();
  await expect(sheet.locator(".line-score tbody tr").first()).toHaveText(
    /Aces\s*26\s*17\s*17\s*29\s*89/,
  );
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
  await expect(body).toHaveAttribute("aria-busy", "false");
});

test("while its meetings load, the sheet holds their shape, with the season stats and leading scorers already in", async ({
  page,
}) => {
  await openApp(page);
  const release = await holdRequests(page, matchPath("/preview"));
  const sheet = await openGameSheet(page, FEVER_AT_ACES);

  await expect(sheet.locator(".sheet-part-head h3")).toHaveText([
    "Meetings",
    "Season stats",
    "Leading scorers",
  ]);
  await expect(sheet.locator(".meetings .placeholder")).toHaveCount(9);
  await expect(sheet.locator(".placeholder")).toHaveCount(9);
  await expect(sheet.locator(".tape-label")).toHaveCount(6);
  await expect(sheet.locator(".players tbody tr:not(.players-head)").first()).toHaveText(
    /Kelsey Mitchell\s*24\.7\s*1\.7\s*2\.8/,
  );

  release();
  await expect(sheet.locator(".meetings li")).toHaveCount(3);
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
});

test("a finger coming down on a game starts reading its box score, and the sheet the tap opens uses that read", async ({
  page,
}) => {
  await openApp(page);
  const reads = countBoxScoreReads(page);
  const button = await findGameButton(page, ACES_AT_FEVER);

  await button.dispatchEvent("pointerdown");
  await expect.poll(() => reads.count).toBe(1);

  await button.click();
  await expect(page.locator("#gameSheet .line-score")).toBeVisible();
  expect(reads.count).toBe(1);
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

/**
 * How far down each of a text's words sits, so a test can tell which line it's on.
 * @param {import("@playwright/test").Locator} element
 */
const readWordTops = (element) =>
  element.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const tops = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = /** @type {Text} */ (node);
      for (const word of text.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        tops.push({ word: word[0], top: Math.round(range.getBoundingClientRect().top) });
      }
    }
    return tops;
  });

/** @param {{ word: string, top: number }[]} tops */
const groupLines = (tops) =>
  [...new Set(tops.map(({ top }) => top))].map((line) =>
    tops
      .filter(({ top }) => top === line)
      .map(({ word }) => word)
      .join(" "),
  );

test.describe("on a phone, with less motion", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("a team stat's label that takes two lines splits them evenly", async ({ page }) => {
    await openApp(page);
    const sheet = await openGameSheet(page, ACES_AT_FEVER);
    const label = sheet.locator(".tape-label", { hasText: "Points in the paint" });
    await expect(label).toBeVisible();

    expect(groupLines(await readWordTops(label))).toEqual(["Points in", "the paint"]);
  });

  test("the game's facts under the team stats break only after a dot, each fact on one line", async ({
    page,
  }) => {
    const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
    await app.changeSeason(startValkyriesAtWings);
    const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
    const note = sheet.locator(".tape-note");
    await expect(note).toContainText("Timeouts left");

    expect(groupLines(await readWordTops(note))).toEqual([
      "Biggest lead: Valkyries 8, Wings 8 \u2022 Lead changes: 15 \u2022",
      "Ties: 14 \u2022 Timeouts left: Valkyries 0, Wings 1",
    ]);
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
  await expect(fever).toHaveCSS("font-weight", "600");
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

/**
 * Opens the sheet of today's game between the Mystics and the Dream, which ESPN carries.
 * @param {import("@playwright/test").Page} page
 */
async function openWashingtonSheet(page) {
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator('#seasonGames [data-game="1042600132"] .game-open').click();
  return page.locator("#gameSheet");
}

test("a game's sheet says where to watch it while it's yet to end, under its time, and not once it's over, and its row doesn't", async ({
  page,
}) => {
  const app = await openApp(page);
  const sheet = await openWashingtonSheet(page);
  const networks = sheet.getByRole("group", { name: "Where to watch" });
  await expect(networks.getByRole("img")).toHaveAttribute("alt", "ESPN");
  await expect(networks.getByRole("img")).toBeVisible();
  await expect(page.locator("#seasonGames .network-logo")).toHaveCount(0);
  const faceOff = await sheet.locator(".faceoff-score").boundingBox();
  const logo = await networks.getByRole("img").boundingBox();
  expect(logo.y).toBeGreaterThan(faceOff.y + faceOff.height);

  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "final", status: "Final" });
    Object.assign(game.away, { score: 80 });
    Object.assign(game.home, { score: 77 });
    return season;
  });
  await expect(sheet.locator(".faceoff-status")).toHaveText("Final");
  await expect(networks).toHaveCount(0);
  await expect(sheet.locator(".networks")).toHaveCount(0);
});

test("a game yet to end whose channels aren't listed yet says to check back, under its time", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600132").networks = [];
    return season;
  });
  const sheet = await openWashingtonSheet(page);
  const note = sheet.locator(".faceoff .networks-pending");
  await expect(note).toHaveText("Check back for where to watch");
  const faceOff = await sheet.locator(".faceoff-score").boundingBox();
  expect((await note.boundingBox()).y).toBeGreaterThan(faceOff.y + faceOff.height);
  expect(await listOffScaleText(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

/** @type {["light" | "dark", string, string][]} */
const LOGO_LOOKS = [
  ["light", "for-light", "for-dark"],
  ["dark", "for-dark", "for-light"],
];
for (const [scheme, shown, hidden] of LOGO_LOOKS) {
  test(`in the ${scheme} look, a sheet shows each channel's logo in its version for that background`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const app = await openApp(page);
    await app.changeSeason((season) => {
      season.games.find((each) => each.id === "1042600132").networks = ["NBC", "ESPN"];
      return season;
    });
    const sheet = await openWashingtonSheet(page);
    const logo = sheet.locator(`.network-logo.${shown}`);
    await expect(logo).toBeVisible();
    await expect(logo).toHaveJSProperty("complete", true);
    await expect(logo).not.toHaveJSProperty("naturalWidth", 0);
    await expect(sheet.locator(`.network-logo.${hidden}`)).toBeHidden();
    await expect(sheet.getByRole("img", { name: "ESPN" })).toBeVisible();
  });
}

const readNameOffset = (sheet) =>
  sheet.locator(".network-name").evaluate((name) => {
    const readMiddle = (element) => {
      const box = element.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    };
    return readMiddle(name) - readMiddle(name.parentElement);
  });

test("in a sheet, a channel without a logo sits half a pixel above the logos' middle", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600132").networks = ["ABC", "ION"];
    return season;
  });
  const sheet = await openWashingtonSheet(page);
  await expect(sheet.locator(".network-name")).toHaveText("ION");

  expect(await readNameOffset(sheet)).toBe(-0.5);
});

test("in a sheet, a square badge is drawn taller than a long wordmark", async ({ page }) => {
  const app = await openApp(page);
  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600132").networks = ["ABC", "ESPN"];
    return season;
  });
  const sheet = await openWashingtonSheet(page);
  const abc = await sheet.getByRole("img", { name: "ABC" }).boundingBox();
  const espn = await sheet.getByRole("img", { name: "ESPN" }).boundingBox();
  expect(abc.height).toBeGreaterThan(espn.height * 1.2);
  expect(espn.height).toBeGreaterThan(10);
});

test("a final's sheet offers Game and Highlights pills, and its Highlights show ESPN's recap video, its story, and each clip", async ({
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
