import {
  test,
  expect,
  openApp,
  openBracket,
  buildFixtureSnapshot,
  chooseSeason,
  EVENING_FIXTURE,
  readColor,
  SEASON_2025,
} from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { WIDE_SCREEN } from "./screen-sizes.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

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
  await expect(eliminated).toHaveCSS("color", await readColor(page, "--out"));
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
  await openBracket(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
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

for (const { colorScheme, theme, winner, loser } of /** @type {const} */ ([
  {
    colorScheme: "light",
    theme: "Ball",
    winner: { lift: 0, digit: 0.5 },
    loser: { lift: 0.25, digit: 1 },
  },
  {
    colorScheme: "dark",
    theme: "Night Game",
    winner: { lift: 0.5, digit: 0.5 },
    loser: { lift: 1.25, digit: 1.5 },
  },
])) {
  test(`in ${theme}, each series' chips and their digits sit where its colors look centered, in boxes of one height`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openApp(page, {
      store: { "seasons/2025": SEASON_2025 },
    });
    await chooseSeason(page, "2025");
    const wildCard = page.locator("#bracketWrap .series").filter({ hasText: "Reds" });
    const readPlace = (club) =>
      wildCard
        .locator(".matchup-row")
        .filter({ hasText: club })
        .locator(".nscore")
        .evaluate((chip) => {
          const style = getComputedStyle(chip);
          return {
            lift: parseFloat(style.marginBottom) / 2,
            digit: (parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / 2,
            height: chip.getBoundingClientRect().height,
          };
        });

    const [dodgers, reds] = await Promise.all([readPlace("Dodgers"), readPlace("Reds")]);
    expect({ lift: dodgers.lift, digit: dodgers.digit }).toEqual(winner);
    expect({ lift: reds.lift, digit: reds.digit }).toEqual(loser);
    expect(dodgers.height).toBe(reds.height);
  });
}

for (const { colorScheme, theme, plain } of /** @type {const} */ ([
  { colorScheme: "light", theme: "Ball", plain: { fill: [253, 250, 244], shade: 0.18 } },
  { colorScheme: "dark", theme: "Night Game", plain: { fill: [30, 58, 43], shade: 0.44 } },
])) {
  test(`in ${theme}, a score chip that isn't the series winner's is filled and shaded as chosen, and the winner's keeps its deep shade`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openApp(page, {
      store: { "seasons/2025": SEASON_2025 },
    });
    await chooseSeason(page, "2025");
    const wildCard = page.locator("#bracketWrap .series").filter({ hasText: "Reds" });
    const readChip = (club) =>
      wildCard
        .locator(".matchup-row")
        .filter({ hasText: club })
        .locator(".nscore")
        .evaluate((chip) => {
          const style = getComputedStyle(chip);
          const context = document.createElement("canvas").getContext("2d");
          context.fillStyle = style.backgroundColor;
          context.fillRect(0, 0, 1, 1);
          const shade = style.boxShadow.match(/^rgba\(0, 0, 0, ([\d.]+)\)/);
          return {
            fill: [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)],
            shade: Number(shade[1]),
          };
        });

    const [winner, other] = await Promise.all([readChip("Dodgers"), readChip("Reds")]);
    expect(other).toEqual(plain);
    expect(winner.shade).toBe(0.44);
  });
}

test("on a wide screen, the whole bracket shows without round dots", async ({ page }) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  await expect(page.locator("#bracketWrap .tree-scroll")).not.toHaveClass(/stacked/);
  await expect(page.locator("#bracketWrap .round-dots")).toHaveCount(0);
});

const WILD_CARD_SERIES = ["AL_WC1", "AL_WC2", "NL_WC1", "NL_WC2"];

for (const width of [360, 390]) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("every card's next game fits on one line under it", async ({ page }) => {
      await openBracket(page);
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
      id: "NYY-BOS",
      away: "NYY",
      home: "BOS",
      state: "live",
      start,
      score: [2, 3],
      inning: 4,
      half: "top",
      outs: 1,
    },
    {
      id: "PHI-ATL",
      away: "PHI",
      home: "ATL",
      state: "live",
      start,
      score: [4, 1],
      inning: 5,
      half: "middle",
    },
    {
      id: "SD-CHC",
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
  await openBracket(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const notes = page.locator("#bracketWrap .card-note");

  const batting = notes.filter({ hasText: /^3-2 Top 4th$/ });
  await expect(batting).toHaveCount(1);
  await expect(batting).toHaveCSS("color", await readColor(page, "--now"));
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
  await expect(delayed).toHaveCSS("color", await readColor(page, "--highlight"));
  await expect(delayed.locator(".out-light")).toHaveCount(0);
  await expect(notes.filter({ hasText: /^Today\u20227:08\sPM$/ })).toHaveCount(1);
});

// The page's clock reads 8:44:43 PM Eastern.
const buildFirstPitchSnapshot = (start, slateGame = {}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  for (const seriesId of WILD_CARD_SERIES)
    snapshot.series[seriesId].next = { at: start, date: "2026-09-24", tbd: false, game: 1 };
  snapshot.slate.today.games.push({
    id: "NYY-BOS",
    away: "NYY",
    home: "BOS",
    state: "pre",
    start,
    ...slateGame,
  });
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
  await expect(countdown).toHaveCSS("color", await readColor(page, "--now"));
  await expect(notes.filter({ hasText: /^Today\u20229:02\sPM$/ })).toHaveCount(3);

  await page.clock.runFor(60 * 1000);
  await expect(notes.filter({ hasText: /^First pitch in 17 min$/ })).toHaveCount(1);
});

test("redrawing the bracket each minute keeps keyboard focus on it", async ({ page }) => {
  await openBracket(page);
  const bracket = page.getByRole("region", { name: "Bracket" });
  await bracket.focus();

  await page.clock.runFor(60 * 1000);
  await expect(bracket).toBeFocused();
});

test("on a wide screen, the AL and NL face each other across the World Series", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openBracket(page);
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
  ).toHaveCSS("color", await readColor(page, "--highlight"));

  const divisions = bracket.locator(".box").filter({ hasText: "Division Series" });
  const upperDivision = await divisions.nth(0).boundingBox();
  const lowerDivision = await divisions.nth(1).boundingBox();
  const noteAndGap = lowerDivision.y - (upperDivision.y + upperDivision.height);
  expect(noteAndGap).toBe(80);
});

test("on a wide screen, each league's seed labels sit on its outer side", async ({ page }) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openBracket(page);
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
  await openBracket(page);
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
