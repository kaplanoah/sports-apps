import { test, expect, MATCHUP_STARTERS, buildSnapshotWithStarters } from "./harness.mjs";
import { openMatchup } from "./open-game-sheet.mjs";
import { checkRanksAreDim } from "../../../../tests/browser/rank-ink.mjs";
import { readDotRings } from "../../../../tests/browser/dot-ring.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * The ERA row's numbers, as the sheet colors them: each one's text color and weight, whether its
 * dot is dimmed from its club's color, and the ink a number is in unless it ranks lower.
 * @param {import("@playwright/test").Locator} sheet
 */
const readEraColors = (sheet) =>
  sheet
    .locator(".tape-measure")
    .first()
    .evaluate((measure) => {
      /** @param {string} color */
      const paint = (color) => {
        const probe = document.createElement("span");
        probe.style.color = color;
        measure.append(probe);
        const painted = getComputedStyle(probe).color;
        probe.remove();
        return painted;
      };
      /** @param {"away" | "home"} side */
      const readSide = (side) => {
        const number = /** @type {HTMLElement} */ (measure.querySelector(`.tape-number.${side}`));
        const dot = /** @type {HTMLElement} */ (number.querySelector(".tape-dot"));
        const club = paint(getComputedStyle(number).getPropertyValue("--side"));
        return {
          color: getComputedStyle(number).color,
          weight: getComputedStyle(number).fontWeight,
          isDotDimmed: paint(getComputedStyle(dot).backgroundColor) !== club,
        };
      };
      return { away: readSide("away"), home: readSide("home"), ink: paint("var(--ink)") };
    });

test("a starter's number is white and bolder when it ranks above the other's, and dim, with its dot, when it ranks below", async ({
  page,
}) => {
  const era = await readEraColors(await openMatchup(page));
  expect(era.away).toEqual({ color: era.ink, weight: "550", isDotDimmed: false });
  expect(era.home.color).not.toBe(era.ink);
  expect(era.home.isDotDimmed).toBe(true);
});

test("beside a starter who isn't ranked, both numbers are white, and only the unranked starter's dot dims", async ({
  page,
}) => {
  const era = await readEraColors(
    await openMatchup(page, { ...MATCHUP_STARTERS, 2: { ...MATCHUP_STARTERS[2], ranks: null } }),
  );
  expect(era.away).toEqual({ color: era.ink, weight: "400", isDotDimmed: false });
  expect(era.home).toEqual({ color: era.ink, weight: "400", isDotDimmed: true });
});

/** @param {import("@playwright/test").Locator} sheet */
const readNumberLineMiddles = (sheet) =>
  sheet.locator(".tape-measure").evaluateAll((measures) =>
    measures.map((measure) => {
      /** @param {string} selector */
      const readMiddle = (selector) => {
        const box = /** @type {HTMLElement} */ (
          measure.querySelector(selector)
        ).getBoundingClientRect();
        return Math.round(box.top + box.height / 2);
      };
      return {
        away: readMiddle(".tape-number.away .tape-number-line"),
        label: readMiddle(".tape-label"),
        home: readMiddle(".tape-number.home .tape-number-line"),
      };
    }),
  );

test("where an unranked starter near the innings would rank is a hairline in his club's color through each curve, 4px above it and 3.5px past its foot, with no dot", async ({
  page,
}) => {
  const sheet = await openMatchup(page, {
    ...MATCHUP_STARTERS,
    2: { ...MATCHUP_STARTERS[2], ranks: null },
  });
  const lines = sheet.locator(".tape .player-curve i.home.provisional");
  await expect(lines).toHaveCount(4);
  await expect(sheet.locator(".tape-number.home .tape-rank").first()).toHaveText(
    /^would be \d+(st|nd|rd|th)$/,
  );
  const rankLines = await sheet.locator(".tape-number.home .tape-rank").evaluateAll((ranks) =>
    ranks.map((rank) => {
      const range = document.createRange();
      range.selectNodeContents(rank);
      return new Set([...range.getClientRects()].map((line) => Math.round(line.bottom))).size;
    }),
  );
  expect(rankLines).toEqual([1, 1, 1, 1]);

  const shape = await lines.first().evaluate((element) => {
    const curve = /** @type {HTMLElement} */ (element.parentElement);
    const box = element.getBoundingClientRect();
    const curveBox = curve.getBoundingClientRect();
    const place = (parseFloat(element.style.top) / 100) * curveBox.height + curveBox.top;
    const left = (parseFloat(element.style.left) / 100) * curveBox.width + curveBox.left;
    return {
      above: place - box.top,
      past: box.bottom - curveBox.bottom,
      middle: box.left + box.width / 2 - left,
      color: getComputedStyle(element).borderLeftColor,
      side: getComputedStyle(element).getPropertyValue("--side").trim(),
      dots: curve.querySelectorAll("b.home").length,
    };
  });
  expect(shape.above).toBeCloseTo(4, 1);
  expect(shape.past).toBeCloseTo(3.5, 1);
  expect(Math.abs(shape.middle)).toBeLessThanOrEqual(0.5);
  expect(shape.dots).toBe(0);
  const paint = await sheet.evaluate((_, color) => {
    const probe = document.createElement("span");
    probe.style.color = color;
    document.body.append(probe);
    const painted = getComputedStyle(probe).color;
    probe.remove();
    return painted;
  }, shape.side);
  expect(shape.color).toBe(paint);
});

test("a starter's dot at either end of a curve sits right under his number's dot", async ({
  page,
}) => {
  const [blubaugh, springs] = [MATCHUP_STARTERS[1], MATCHUP_STARTERS[2]];
  const spread = blubaugh.starters.values;
  const sheet = await openMatchup(page, {
    1: { ...blubaugh, line: { ...blubaugh.line, k9: spread.k9[0] } },
    2: { ...springs, line: { ...springs.line, era: spread.era[0].toFixed(2) } },
  });
  const offsets = await sheet.locator(".tape-measure").evaluateAll((measures) =>
    measures.slice(0, 2).map((measure, index) => {
      const side = index === 0 ? "home" : "away";
      /** @param {string} selector */
      const readCenter = (selector) => {
        const box = /** @type {Element} */ (
          measure.querySelector(selector)
        ).getBoundingClientRect();
        return box.left + box.width / 2;
      };
      return readCenter(`.player-curve b.${side}`) - readCenter(`.tape-number.${side} .tape-dot`);
    }),
  );
  expect(offsets[0]).toBeCloseTo(0, 1);
  expect(offsets[1]).toBeCloseTo(0, 1);
});

test("each starter's dot on a curve is ringed in the sheet's color, so two that meet stay apart, in Night Game and Ball", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const dots = sheet.locator(".tape .player-curve b");
  await expect(dots.first()).toBeVisible();
  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const rings = await readDotRings(dots);
    expect(rings.length).toBeGreaterThan(0);
    for (const { ring, expected } of rings) expect(ring, theme).toBe(expected);
  }
});

test("a rank, his own or where he would rank, is the dim color throughout and sits 4px clear of the curve under it", async ({
  page,
}) => {
  const sheet = await openMatchup(page, {
    ...MATCHUP_STARTERS,
    2: { ...MATCHUP_STARTERS[2], ranks: null },
  });
  await expect(sheet.locator(".tape-number.home .tape-rank").first()).toHaveText(/^would be /);
  expect(await checkRanksAreDim(sheet, ".tape-rank")).toEqual(Array(8).fill(true));
  const clearances = await sheet.locator(".tape-measure").evaluateAll((measures) =>
    measures.flatMap((measure) => {
      const curve = /** @type {Element} */ (measure.querySelector(".player-curve"));
      return [...measure.querySelectorAll(".tape-rank")].map(
        (rank) => curve.getBoundingClientRect().top - rank.getBoundingClientRect().bottom,
      );
    }),
  );
  expect(clearances).toHaveLength(8);
  for (const clearance of clearances) expect(clearance).toBeCloseTo(4, 0);
});

test("each stat sits 22px under the curve above it, further than that curve's foot from its own rank", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const spaces = await sheet.locator(".tape-measure").evaluateAll((measures) =>
    measures.slice(1).map((measure, index) => {
      const above = measures[index];
      const curve = /** @type {Element} */ (
        above.querySelector(".player-curve")
      ).getBoundingClientRect();
      const rank = /** @type {Element} */ (
        above.querySelector(".tape-rank")
      ).getBoundingClientRect();
      return {
        between: Math.round((measure.getBoundingClientRect().top - curve.bottom) * 10) / 10,
        isNearerOwnRank:
          curve.bottom - rank.bottom <
          /** @type {Element} */ (
            measure.querySelector(".tape-number-line")
          ).getBoundingClientRect().top -
            curve.bottom,
      };
    }),
  );
  expect(spaces).toEqual(Array(3).fill({ between: 22, isNearerOwnRank: true }));
});

test("an unranked starter's numbers sit level with the label and the ranked starter's", async ({
  page,
}) => {
  const sheet = await openMatchup(page, {
    ...MATCHUP_STARTERS,
    2: { ...MATCHUP_STARTERS[2], ranks: null },
  });
  for (const middles of await readNumberLineMiddles(sheet)) {
    expect(middles.home).toBe(middles.away);
    expect(Math.abs(middles.label - middles.away)).toBeLessThanOrEqual(1);
  }
});

test("an unranked starter's note sets his innings against his club's games, a step apart from the curves", async ({
  page,
}) => {
  const athletics = Object.values(buildSnapshotWithStarters().standings.divisions)
    .flat()
    .find((/** @type {any} */ row) => row.id === "ATH");
  const sheet = await openMatchup(page, {
    ...MATCHUP_STARTERS,
    2: { ...MATCHUP_STARTERS[2], ranks: null },
  });
  const notes = sheet.locator(".tape-note");

  await expect(notes).toHaveText([
    "Rank among qualified starters",
    `Springs has pitched 128 2/3 of the ${athletics.w + athletics.l} innings needed to qualify`,
  ]);
  const space = await sheet.locator(".tape").evaluate((tape) => {
    const curves = tape.querySelectorAll(".player-curve");
    const lastCurve = curves[curves.length - 1].getBoundingClientRect();
    const firstNote = /** @type {Element} */ (
      tape.querySelector(".tape-note")
    ).getBoundingClientRect();
    return firstNote.top - lastCurve.bottom;
  });
  expect(space).toBeCloseTo(19.5, 1);
});

test("the Matchup's stat names are a half step over the sheet's capital labels, at 13.5px", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const sizes = await sheet
    .locator(".tape-label")
    .evaluateAll((labels) => labels.map((label) => getComputedStyle(label).fontSize));
  expect(sizes).toEqual(["13.5px", "13.5px", "13.5px", "13.5px"]);
});

/** @param {import("@playwright/test").Locator} chart */
function measurePitchMix(chart) {
  return chart.evaluate((element) => {
    const readNumber = (selector, attribute) =>
      Number(element.querySelector(selector).getAttribute(attribute));
    const lineBox = element.querySelector(".speed-line").getBoundingClientRect();
    const [, , viewWidth] = element.querySelector(".speed-line").getAttribute("viewBox").split(" ");
    const scale = lineBox.width / Number(viewWidth);
    const usage = element.querySelector(".pitch-usage").getBoundingClientRect();
    return {
      lineStart: lineBox.left + readNumber(".speed-axis", "x1") * scale,
      lineEnd: lineBox.left + readNumber(".speed-axis", "x2") * scale,
      usageStart: usage.left,
      usageEnd: usage.right,
      lineDot:
        (2 * readNumber(".pitch-dot", "r") - readNumber(".pitch-dot", "stroke-width")) * scale,
      rowDots: [...element.querySelectorAll(".pitch-key")].map((key) => {
        const box = key.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
      slices: [...element.querySelectorAll(".pitch-usage i")].map(
        (slice) => slice.getBoundingClientRect().width,
      ),
    };
  });
}

test("the bar over the line ends where the line does, split by how often he throws each", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const chart = sheet.locator(".pitch-mix").first();
  await expect(chart.locator(".pitch-usage i")).toHaveCount(3);
  const { lineStart, lineEnd, usageStart, usageEnd, slices } = await measurePitchMix(chart);
  expect(usageStart).toBeCloseTo(lineStart, 0);
  expect(usageEnd).toBeCloseTo(lineEnd, 0);
  const [slider, changeup, fourSeam] = slices;
  expect(fourSeam / slider).toBeCloseTo(0.52 / 0.3, 1);
  expect(changeup / slider).toBeCloseTo(0.17 / 0.3, 1);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 320, height: 640 },
]) {
  test(`at ${viewport.width}px wide, the speed labels stay 13px, each number on its speed, over the pitches`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const sheet = await openMatchup(page);
    const chart = sheet.locator(".pitch-mix").first();
    const labels = chart.locator(".speed-label");
    await expect(labels).toHaveText(["70 mph", "80", "90", "100"]);
    await expect(labels.first()).toHaveCSS("font-size", "13px");
    const { lineStart, lineEnd } = await measurePitchMix(chart);
    const readCenters = () =>
      labels.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return box.left + box.width / 2;
        }),
      );
    const centers = await readCenters();
    expect(centers[0]).toBeCloseTo(lineStart, 0);
    expect(centers.at(-1)).toBeCloseTo(lineEnd, 0);
    const labelsToRows = await chart.evaluate((element) => {
      const scale = element.querySelector(".speed-labels").getBoundingClientRect();
      return element.querySelector(".pitch-rows").getBoundingClientRect().top - scale.bottom;
    });
    expect(Math.round(labelsToRows)).toBe(12);
  });
}

for (const { screen, viewport, smallest } of [
  { screen: "a phone", viewport: { width: 390, height: 844 }, smallest: false },
  { screen: "the narrowest phone", viewport: { width: 320, height: 640 }, smallest: true },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("each row's dot is the speed line's dot, and never under 10px", async ({ page }) => {
      const sheet = await openMatchup(page);
      const chart = sheet.locator(".pitch-mix").first();
      await expect(chart.locator(".pitch-key")).toHaveCount(3);
      const { lineDot, rowDots } = await measurePitchMix(chart);
      const expected = Math.max(10, lineDot);
      expect(lineDot < 10).toBe(smallest);
      for (const { width, height } of rowDots) {
        expect(width).toBeCloseTo(expected, 1);
        expect(height).toBeCloseTo(expected, 1);
      }
    });
  });
}
