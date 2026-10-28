import { test, expect, openApp } from "./harness.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const SMALL_PHONE = { width: 320, height: 640 };
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 900 };
const TONIGHT = "1042600132";

/**
 * The Dream's season with tonight's game in Washington in the third quarter, and a third game in
 * Atlanta still to come, so its sheet has a card of each kind.
 * @param {any} season
 */
function playTonight(season) {
  const tonight = season.nearestGames.find((/** @type {any} */ game) => game.id === TONIGHT);
  const live = {
    ...tonight,
    state: "live",
    period: 3,
    clock: "4:12",
    away: { ...tonight.away, score: 61 },
    home: { ...tonight.home, score: 58 },
  };
  const next = {
    ...tonight,
    id: "1042600133",
    number: 3,
    start: "2026-10-03T00:00:00Z",
    away: tonight.home,
    home: tonight.away,
  };
  const others = season.nearestGames.filter((/** @type {any} */ game) => game.id !== TONIGHT);
  return { ...season, nearestGames: [...others, live, next] };
}

/** @param {import("@playwright/test").Page} page */
async function openDream(page) {
  await page
    .getByRole("button", { name: /^Dream\b.*team details$/ })
    .first()
    .click();
  const sheet = page.locator("#teamSheet");
  await expect(sheet.locator("#teamTitle")).toHaveText("Atlanta Dream");
  return sheet;
}

/**
 * Where each card and the lines in it are, the widest of them all, and how much room the row has.
 * @param {import("@playwright/test").Locator} sheet
 */
const readCards = (sheet) =>
  sheet.locator(".game-cards").evaluate((row) => {
    const readBox = (/** @type {Element} */ element) => {
      const { left, right, top, bottom, width } = element.getBoundingClientRect();
      return { left, right, top, bottom, width };
    };
    const lines = [...row.querySelectorAll(".game-card-when, .game-card-line, .game-card h3")];
    const cards = [...row.querySelectorAll(".game-card-button")].map((card) => {
      const style = getComputedStyle(card);
      return {
        ...readBox(card),
        borders: parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth),
        lines: [...card.querySelectorAll(".game-card-when, .game-card-line")].map(readBox),
        score: readBox(/** @type {Element} */ (card.querySelector(".game-card-score"))),
        team: readBox(/** @type {Element} */ (card.querySelector(".game-card-opponent"))),
      };
    });
    return {
      row: readBox(row),
      isStacked: row.classList.contains("is-stacked"),
      widest: Math.max(...lines.map((line) => line.scrollWidth)),
      cards,
    };
  });

/** @param {Awaited<ReturnType<typeof readCards>>["cards"]} cards */
const listGaps = (cards) => cards.slice(1).map((card, index) => card.left - cards[index].right);

/** @param {Awaited<ReturnType<typeof readCards>>} shown */
function expectEvenCards({ row, cards }) {
  for (const card of cards) {
    expect(card.width).toBeCloseTo(cards[0].width, 1);
    for (const line of card.lines) {
      expect(line.left).toBeGreaterThanOrEqual(card.left);
      expect(line.right).toBeLessThanOrEqual(card.right);
    }
  }
  for (const gap of listGaps(cards)) {
    expect(gap).toBeGreaterThanOrEqual(13.5);
    expect(gap).toBeLessThanOrEqual(22);
  }
  expect(cards[0].left).toBeGreaterThanOrEqual(row.left - 0.5);
  expect(cards.at(-1)?.right).toBeLessThanOrEqual(row.right + 0.5);
}

for (const [name, viewport] of /** @type {const} */ ([
  ["a small phone", SMALL_PHONE],
  ["a phone", PHONE],
])) {
  test(`on ${name}, three cards too wide for one line each set each score over its team, as wide as one another`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const app = await openApp(page);
    await app.changeSeason(playTonight);
    const sheet = await openDream(page);
    await expect(sheet.locator(".game-card-button")).toHaveCount(3);
    await expect(sheet.locator(".game-card-when").nth(1)).toHaveText("Q3 4:12");

    const shown = await readCards(sheet);
    expect(shown.isStacked).toBe(true);
    expectEvenCards(shown);
    for (const card of shown.cards) {
      expect(card.score.bottom).toBeLessThan(card.team.top);
      expect((card.width - card.borders - shown.widest) / 2).toBeLessThanOrEqual(8.5 + 0.5);
    }
  });
}

for (const [name, viewport] of /** @type {const} */ ([
  ["a phone", PHONE],
  ["a wide screen", WIDE],
])) {
  test(`on ${name}, two cards each take one line, 8.5px beside the widest, and center under the band`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    const sheet = await openDream(page);
    await expect(sheet.locator(".game-card-button")).toHaveCount(2);

    const shown = await readCards(sheet);
    expect(shown.isStacked).toBe(false);
    expectEvenCards(shown);
    for (const card of shown.cards) {
      expect(card.score.top).toBeCloseTo(card.team.top, 0);
      expect((card.width - card.borders - shown.widest) / 2).toBeCloseTo(8.5, 0);
    }
    const [first, second] = shown.cards;
    expect((first.left + second.right) / 2).toBeCloseTo((shown.row.left + shown.row.right) / 2, 0);
  });
}

test("a tap on a card opens its game's sheet beside the team's, and Back returns to the team", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page
    .getByRole("button", { name: /Aces\b.*team details$/ })
    .first()
    .click();
  const teamSheet = page.locator("#teamSheet");

  await teamSheet.getByRole("button", { name: /Sep 29\b.*game details$/ }).click();

  const gameSheet = page.locator("#gameSheet");
  await expect(gameSheet.locator("#gameTitle")).toHaveText("First Round Game 2");
  await expect(gameSheet.locator(".line-score")).toBeVisible();
  await gameSheet.getByRole("button", { name: "Back to Team", exact: true }).click();
  await expect(gameSheet).toBeHidden();
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
});

test("a card's lines sit at their spacing, from the tops of their capitals to their baselines, in their weights and colors", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const app = await openApp(page);
  await app.changeSeason(playTonight);
  const sheet = await openDream(page);
  await expect(sheet.locator(".game-card-when").nth(1)).toHaveText("Q3 4:12");

  const cards = await sheet.locator(".game-card").evaluateAll((elements) =>
    elements.map((card) => {
      const readBox = (/** @type {string} */ selector) => {
        const { top, bottom } = /** @type {Element} */ (
          card.querySelector(selector)
        ).getBoundingClientRect();
        return { top, bottom };
      };
      const readType = (/** @type {string} */ selector) => {
        const { fontWeight, color, fontFamily } = getComputedStyle(
          /** @type {Element} */ (card.querySelector(selector)),
        );
        return { weight: fontWeight, color, font: fontFamily.split(",")[0].replaceAll('"', "") };
      };
      const button = readBox(".game-card-button");
      return {
        titleToCard: button.top - readBox("h3").bottom,
        aboveDay: readBox(".game-card-when").top - button.top - 1,
        dayToScore: readBox(".game-card-score").top - readBox(".game-card-when").bottom,
        scoreToTeam: readBox(".game-card-name").top - readBox(".game-card-score").bottom,
        belowTeam: button.bottom - 1 - readBox(".game-card-name").bottom,
        title: readType("h3"),
        day: readType(".game-card-when"),
        clock: card.querySelector(".game-card-now") && readType(".game-card-now"),
        result: card.querySelector(".game-card-result") && readType(".game-card-result"),
        margin: card.querySelector(".game-card-margin") && readType(".game-card-margin"),
        score: readType(".game-card-score"),
        at: readType(".game-card-at"),
        name: readType(".game-card-name"),
      };
    }),
  );
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const probe = document.createElement("i");
    document.body.append(probe);
    const readColor = (/** @type {string} */ token) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const colors = { now: readColor("--now"), result: readColor("--result") };
    probe.remove();
    return { ...colors, hasTokens: style.getPropertyValue("--now") !== "" };
  });

  for (const card of cards) {
    expect(card.titleToCard).toBeCloseTo(2.5, 0);
    expect(card.aboveDay).toBeCloseTo(8.5, 0);
    expect(card.dayToScore).toBeCloseTo(8, 0);
    expect(card.scoreToTeam).toBeCloseTo(6.5, 0);
    expect(card.belowTeam).toBeCloseTo(7.5, 0);
    expect([card.title.weight, card.day.weight, card.score.weight]).toEqual(["600", "500", "600"]);
    expect([card.at.weight, card.name.weight, card.name.font]).toEqual([
      "400",
      "400",
      "Barlow Condensed",
    ]);
  }
  const [last, now] = cards;
  expect(tokens.hasTokens).toBe(true);
  expect(last.result).toEqual({ ...last.result, weight: "500", color: tokens.result });
  expect(now.clock).toEqual({ ...now.clock, weight: "500", color: tokens.now });
  expect(now.margin?.weight).toBe("500");
});

test("a team without a game yet starts its sheet 20px under the band", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await page.locator('#standings-league tr[data-team="SEA"] .team-open').click();
  const sheet = page.locator("#teamSheet");
  await expect(sheet.locator("#teamTitle")).toHaveText("Seattle Storm");
  await expect(sheet.locator(".game-cards")).toHaveCount(0);

  const top = await sheet.locator(".sheet-top").boundingBox();
  const firstPart = await sheet.locator(".sheet-part-head").first().boundingBox();
  expect((firstPart?.y ?? 0) - ((top?.y ?? 0) + (top?.height ?? 0))).toBeCloseTo(20, 0);
});
