import {
  test,
  expect,
  openApp,
  openGameSheet,
  keepHighlights,
  matchPath,
  formatRgb,
} from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { readOklab } from "../../../../shared/page/team-colors.js";
import { TEAMS } from "../../page/js/teams.js";
import {
  ACES_AT_FEVER,
  FEVER_AT_ACES,
  VALKYRIES_AT_WINGS,
  startValkyriesAtWings,
  finishValkyriesAtWings,
  liveBoxScore,
} from "./game-sheet-games.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

// A players table's number column, while the names leave it room.
const NUMBER_COLUMN_PX = 52;
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

// These tests are about what a sheet shows, so they skip the eased scrolling between the Games
// lists.
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

test("a game's title is a heading, over its series and day as details", async ({ page }) => {
  await openApp(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);

  const heading = await readRole(page, "heading");
  await expect(sheet.locator("#gameTitle")).toHaveCSS("font-size", `${heading.size}px`);
  await expect(sheet.locator("#gameTitle")).toHaveCSS("font-weight", String(heading.weight));
  await expect(sheet.locator("#gameWhen")).toHaveCSS(
    "font-size",
    `${(await readRole(page, "detail")).size}px`,
  );
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

    test("the lead chart's words sit on lines as tall as their text, with no room above or below", async ({
      page,
    }) => {
      const app = await openApp(page);
      await app.changeSeason(finishValkyriesAtWings);
      const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
      const words = sheet.locator(
        ".lead-chart :is(.lead-side, .lead-reach, .lead-peak-label, .lead-period)",
      );
      await expect(words).toHaveCount(11);
      const lines = await words.evaluateAll((elements) =>
        elements.map((element) => ({
          height: element.getBoundingClientRect().height,
          size: parseFloat(getComputedStyle(element).fontSize),
        })),
      );
      for (const { height, size } of lines) expect(height).toBeCloseTo(size, 0);
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
  await openSeasonPart(page, "Standings");
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

for (const { screen, viewport } of [
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
  { screen: "a phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("every piece of text in a live game's row, its sheet, a final's sheet and its Highlights, and a preview keeps to its type role", async ({
      page,
    }) => {
      const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
      await app.changeSeason(startValkyriesAtWings);
      await keepHighlights(page, app, ACES_AT_FEVER);
      const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
      await expect(page.locator(".bonus").first()).toBeAttached();
      await expect(sheet.locator(".line-score th.now")).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator(".clock").first()).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      const final = await openGameSheet(page, ACES_AT_FEVER);
      await expect(final.locator(".line-score")).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await final.getByRole("tab", { name: "Highlights" }).click();
      await expect(final.locator("#highlightsBody .clip-row").first()).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(final).toBeHidden();
      const preview = await openGameSheet(page, FEVER_AT_ACES);
      await expect(preview.locator(".meeting-score").first()).toBeVisible();
      expect(await listTextOffRoles(page)).toEqual([]);
      expect(await listLowContrastText(page)).toEqual([]);
      expect(await listStrayPeriods(page)).toEqual([]);
    });
  });
}

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
  expect(await listTextOffRoles(page)).toEqual([]);
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
