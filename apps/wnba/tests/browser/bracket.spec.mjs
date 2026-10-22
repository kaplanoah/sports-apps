import { TEAMS } from "../../page/js/teams.js";
import { finishFirstRound, finishSemifinals, showFirstRoundFinished } from "./bracket-rounds.mjs";
import { test, expect, openApp, formatRgb } from "./harness.mjs";
import {
  findSeasonPill,
  findSeasonTab,
  openSeasonPart,
} from "../../../../tests/browser/season-tab.mjs";
import { readSeasonPartScroll } from "../../../../tests/browser/season-scroll.mjs";
import { readRole } from "../../../../tests/browser/type-roles.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PHONE = { width: 390, height: 844 };

const readRoundName = (page, round) => page.locator(`.round-name[data-round="${round}"]`);

test.describe("on a phone, the bracket", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("opens on the earliest round still playing, and swipes either way", async ({ page }) => {
    const app = await openApp(page);
    await expect(readRoundName(page, 1)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-series="1-0"] .seed-label').first()).toBeInViewport({
      ratio: 1,
    });
    await expect(page.locator('.round-dots [data-round="1"]')).toHaveClass("on");

    await app.changeSeason(finishFirstRound);
    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
    await expect(readRoundName(page, 1)).not.toBeInViewport();
    await expect(page.locator('.round-dots [data-round="2"]')).toHaveClass("on");

    await page.locator(".bracket").evaluate((tree) => (tree.scrollLeft = 0));
    await expect(readRoundName(page, 1)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.round-dots [data-round="1"]')).toHaveClass("on");

    await page.getByRole("tab", { name: "Games" }).click();
    await openSeasonPart(page, "Bracket");
    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
  });

  test("comes back to the round still playing with a tap on its tab, from a round before or after it, or from the standings", async ({
    page,
  }) => {
    const app = await openApp(page);
    await app.changeSeason(finishFirstRound);
    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
    expect(await readSeasonPartScroll(page, "bracket")).toBe(0);

    for (const left of [0, Number.MAX_SAFE_INTEGER]) {
      await page.locator(".bracket").evaluate((tree, to) => (tree.scrollLeft = to), left);
      await expect(readRoundName(page, 2)).not.toBeInViewport({ ratio: 1 });

      await findSeasonTab(page).click();

      await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
    }

    await page.locator(".bracket").evaluate((tree) => (tree.scrollLeft = 0));
    await findSeasonPill(page).getByRole("tab", { name: "Standings" }).click();
    await expect(page.locator("#standings-league")).toBeVisible();

    await findSeasonTab(page).click();

    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
    await expect(readRoundName(page, 1)).not.toBeInViewport();
  });

  test.describe("in full motion", () => {
    test.use({ contextOptions: { reducedMotion: "no-preference" } });

    test("glides back to the round still playing with a tap on its tab, never stepping back", async ({
      page,
    }) => {
      const app = await openApp(page);
      await app.changeSeason(finishFirstRound);
      await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
      const tree = page.locator(".bracket");
      const opening = await tree.evaluate((element) => element.scrollLeft);
      await tree.evaluate((element) => (element.scrollLeft = 0));
      await expect(readRoundName(page, 1)).toBeInViewport({ ratio: 1 });
      const lefts = tree.evaluate(
        (element) =>
          new Promise((resolve) => {
            const seen = /** @type {number[]} */ ([]);
            element.addEventListener("scroll", () => seen.push(element.scrollLeft));
            element.addEventListener("scrollend", () => resolve(seen), { once: true });
          }),
      );

      await findSeasonTab(page).click();

      const seen = /** @type {number[]} */ (await lefts);
      expect(new Set(seen).size).toBeGreaterThan(2);
      for (let index = 1; index < seen.length; index += 1)
        expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1]);
      expect(seen.at(-1)).toBeCloseTo(opening, 0);
      await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
    });
  });

  test("centers the Finals on the screen, opening on them or swiped to them", async ({ page }) => {
    const app = await openApp(page);
    const readFinalsOffCenter = () =>
      page.locator(".bracket").evaluate((tree) => {
        const middle = (/** @type {Element} */ element) => {
          const box = element.getBoundingClientRect();
          return box.left + box.width / 2;
        };
        const finals = /** @type {Element} */ (tree.querySelector('[data-series="3-0"]'));
        return Math.abs(middle(finals) - middle(tree));
      });

    await app.changeSeason(finishSemifinals);
    await expect(readRoundName(page, 3)).toBeInViewport({ ratio: 1 });
    await expect.poll(readFinalsOffCenter).toBeLessThan(1);
    await expect(page.locator('.round-dots [data-round="3"]')).toHaveClass("on");

    await page.locator(".bracket").evaluate((tree) => (tree.scrollLeft = 0));
    await page
      .locator(".bracket")
      .evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));
    await expect.poll(readFinalsOffCenter).toBeLessThan(1);
  });

  test("pins its round dots just above the tab bar, and lights the last round at the scroll's end", async ({
    page,
  }) => {
    await openApp(page);
    const dots = page.locator(".round-dots");
    await expect(dots.locator('[data-round="1"]')).toHaveClass("on");
    const dotsBox = await dots.boundingBox();
    const bar = await page.locator("#tabBar").boundingBox();
    expect(bar.y - (dotsBox.y + dotsBox.height)).toBeGreaterThan(0);
    expect(bar.y - (dotsBox.y + dotsBox.height)).toBeLessThanOrEqual(16);

    await page
      .locator(".bracket")
      .evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));
    await expect(dots.locator('[data-round="3"]')).toHaveClass("on");
  });

  test("on the Semifinals, the first round's lines run off the screen's edge without turning at it", async ({
    page,
  }) => {
    const app = await openApp(page);
    await app.changeSeason(finishFirstRound);
    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
    /** Each turn's place on the screen, and whether it shows past the turns' clip. */
    const readTurns = () =>
      page.locator(".bracket-turns").evaluate((svg) => {
        const clipLeft = Number(getComputedStyle(svg).clipPath.match(/([\d.]+)px\)$/)?.[1]);
        const svgLeft = svg.getBoundingClientRect().left;
        return [...svg.querySelectorAll("path")].map((path) => {
          const x = svgLeft + /** @type {SVGPathElement} */ (path).getBBox().x;
          return { next: path.dataset.next, x, isShown: x >= svgLeft + clipLeft };
        });
      });
    await expect
      .poll(async () =>
        (await readTurns()).filter((turn) => !turn.isShown).map((turn) => turn.next),
      )
      .toEqual(["2-0", "2-1"]);
    for (const turn of await readTurns()) if (!turn.isShown) expect(turn.x).toBeLessThan(16);
    const card = await page.locator('[data-series="2-0"]').boundingBox();
    // The line into a card starts at its turn: the last move in its shape.
    const lineStart = await page
      .locator('.bracket-lines path[data-next="2-0"]')
      .evaluate((path) => {
        const svg = /** @type {Element} */ (path.closest("svg")).getBoundingClientRect();
        const moves = [...String(path.getAttribute("d")).matchAll(/M([\d.]+)/g)];
        return svg.left + Number(moves.at(-1)?.[1]);
      });
    expect(lineStart).toBeLessThan(2);
    expect(card.x - lineStart).toBeGreaterThan(14);

    await page.locator(".bracket").evaluate((tree) => (tree.scrollLeft = 0));
    await expect.poll(async () => (await readTurns()).every((turn) => turn.isShown)).toBe(true);
  });

  test("shows the next round's edge beside the one it opens on", async ({ page }) => {
    await openApp(page);
    await expect(page.locator('[data-series="2-0"]')).toBeVisible();
    const next = await page.locator('[data-series="2-0"]').boundingBox();
    expect(next.x).toBeLessThan(PHONE.width);
    expect(next.x + next.width).toBeGreaterThan(PHONE.width);
    const pageOverflow = await page.evaluate(
      () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    );
    expect(pageOverflow).toBe(0);
  });
});

test("a first-round seed's label sits outside its card, beside its row", async ({ page }) => {
  await openApp(page);
  const card = page.locator('[data-series="1-0"]');
  const row = card.locator(".team-line").filter({ hasText: "Liberty" });
  await expect(row.locator(".seed-label")).toHaveText("8 seed");
  const label = await row.locator(".seed-label").boundingBox();
  const cardBox = await card.boundingBox();
  const rowBox = await row.boundingBox();
  expect(label.x).toBeGreaterThanOrEqual(0);
  expect(label.x + label.width).toBeLessThan(cardBox.x);
  expect(Math.abs(label.y + label.height / 2 - (rowBox.y + rowBox.height / 2))).toBeLessThan(1);
  await expect(page.locator('[data-series="2-0"] .seed-label')).toHaveCount(0);
});

test("a seed's number and Seed share a baseline, each trimmed to its letters", async ({ page }) => {
  await openApp(page);
  const label = page.locator('[data-series="1-0"] .seed-label').first();
  await expect(label).toBeVisible();
  const [number, word] = await label.evaluate((element) =>
    [".seed-number", ".seed-word"].map((selector) => {
      const part = /** @type {Element} */ (element.querySelector(selector));
      const box = part.getBoundingClientRect();
      return {
        bottom: box.bottom,
        height: box.height,
        fontSize: parseFloat(getComputedStyle(part).fontSize),
      };
    }),
  );
  expect(Math.abs(number.bottom - word.bottom)).toBeLessThan(0.3);
  for (const part of [number, word]) expect(part.height).toBeLessThan(part.fontSize * 0.8);
});

test("every round's cards are one width, and each round's name starts where its cards do", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator('[data-series="3-0"]')).toBeVisible();
  const readBox = (selector) => page.locator(selector).boundingBox();
  const cards = await Promise.all(
    ["1-0", "2-0", "3-0"].map((id) => readBox(`[data-series="${id}"]`)),
  );
  for (const card of cards) expect(card.width).toBeCloseTo(cards[0].width, 0);
  for (const [index, card] of cards.entries()) {
    const name = await readRoundName(page, index + 1).boundingBox();
    expect(name.x).toBeCloseTo(card.x, 0);
    expect(name.width).toBeCloseTo(card.width, 0);
  }
});

test("a card has no header, and its note hangs just under it, in one plain color", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator(".series-head")).toHaveCount(0);
  const notes = page.locator(".card-note");
  await expect(notes).toHaveCount(6);
  await expect(page.locator('[data-series="1-0"] .card-note')).toHaveCount(0);
  await expect(page.locator('[data-series="2-0"] .card-note')).toHaveText("Next game TBD");
  for (const id of ["1-3", "1-1", "1-2", "2-0", "2-1", "3-0"]) {
    const card = await page.locator(`[data-series="${id}"]`).boundingBox();
    const note = await page.locator(`[data-series="${id}"] .card-note`).boundingBox();
    expect(note.y - (card.y + card.height)).toBeCloseTo(2, 0);
    expect(note.x).toBeGreaterThanOrEqual(card.x);
    expect(note.x + note.width).toBeLessThanOrEqual(card.x + card.width);
  }
  const styles = await notes.evaluateAll((elements) =>
    elements.map((note) => {
      const { color, fontWeight } = getComputedStyle(note);
      return `${color} ${fontWeight}`;
    }),
  );
  expect(new Set(styles).size).toBe(1);
});

test("a live game's note shows its score and clock in orange", async ({ page }) => {
  const app = await openApp(page);
  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    game.away.score = 30;
    game.home.score = 28;
    return season;
  });
  const note = page.locator('[data-series="1-3"] .card-note');
  await expect(note).toHaveText("30-28 with 5:10 in Q2");
  expect(await note.evaluate((element) => getComputedStyle(element).color)).toBe(
    await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--orange)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }),
  );
});

test("every round's name is one color, even the round the bracket opens on", async ({ page }) => {
  await openApp(page);
  const readColor = (round) =>
    readRoundName(page, round)
      .locator(":scope > span")
      .first()
      .evaluate((name) => {
        return getComputedStyle(name).color;
      });
  await expect(readRoundName(page, 1)).toBeVisible();
  expect(await readColor(1)).toBe(await readColor(2));
  expect(await readColor(1)).toBe(await readColor(3));
});

/**
 * Each bracket's ends, and the middle of the line between each card's two teams, in the page's
 * coordinates.
 * @param {import("@playwright/test").Page} page
 */
const readBrackets = (page) =>
  page.evaluate(() => {
    const svg = document.querySelector(".bracket-lines").getBoundingClientRect();
    const readDivider = (id) => {
      const bottom = document.querySelectorAll(`.series[data-series="${id}"] .team-line`)[1];
      return bottom.getBoundingClientRect().top + bottom.clientTop / 2;
    };
    const paths = /** @type {SVGPathElement[]} */ ([
      ...document.querySelectorAll(".bracket-lines path"),
    ]);
    return {
      brackets: paths.map((path) => {
        const length = path.getTotalLength();
        const start = path.getPointAtLength(0);
        const end = path.getPointAtLength(length);
        return {
          next: path.dataset.next,
          shape: path.getAttribute("d"),
          start: svg.top + start.y,
          end: svg.top + end.y,
        };
      }),
      dividers: Object.fromEntries(
        ["1-0", "1-3", "1-1", "1-2", "2-0", "2-1", "3-0"].map((id) => [id, readDivider(id)]),
      ),
    };
  });

test("thin square bracket lines run from the line between each pair's teams into the one they feed", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator(".bracket-lines path")).toHaveCount(3);
  await expect(page.locator(".bracket-lines path").first()).toHaveCSS("stroke-width", "1px");
  const expectJoins = async () => {
    const { brackets, dividers } = await readBrackets(page);
    const feeders = { "2-0": "1-0", "2-1": "1-1", "3-0": "2-0" };
    expect(brackets.map((bracket) => bracket.next)).toEqual(["2-0", "2-1", "3-0"]);
    for (const bracket of brackets) {
      expect(bracket.shape).toMatch(/^M[\d. ]+( [HV][\d.]+| M[\d. ]+)+$/);
      expect(Math.abs(bracket.start - dividers[feeders[bracket.next]])).toBeLessThan(0.1);
      expect(Math.abs(bracket.end - dividers[bracket.next])).toBeLessThan(0.1);
    }
  };
  await expect.poll(async () => (await readBrackets(page)).brackets[0].end).toBeGreaterThan(0);
  await expectJoins();

  // The 8-seed Liberty win the upper series and play under the 4-seed Dream; the lines don't move.
  await showFirstRoundFinished(page, app);
  await expectJoins();
});

test("a team's dot splits its colors top and bottom at the team's own split, with nothing between them", async ({
  page,
}) => {
  await openApp(page);
  const club = page.locator('[data-series="1-0"] [data-team]').first();
  const team = TEAMS[/** @type {string} */ (await club.getAttribute("data-team"))];
  expect(team.dotSplit).not.toBe(50);
  const dot = club.locator(".dot");
  await expect(dot).toHaveCSS(
    "background-image",
    `linear-gradient(${formatRgb(team.color)} ${team.dotSplit}%, rgba(0, 0, 0, 0) ${team.dotSplit}%)`,
  );
  await expect(dot).toHaveCSS("background-color", formatRgb(team.color2));
});

test("a team's dot draws its top color once, so no sliver of it can show along the bottom edge", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator('[data-series="1-0"] .dot').first()).toHaveCSS(
    "background-repeat",
    "no-repeat",
  );
});

test("a team's dot is set into the floor, shadowed inside its top left and lit below its bottom right", async ({
  page,
}) => {
  await openApp(page);
  const dot = page.locator('[data-series="1-0"] .dot').first();
  const readShadows = () =>
    dot.evaluate((element) => getComputedStyle(element).boxShadow.split(/,(?![^(]*\))/));
  const readAlpha = (shadow) =>
    Number(/\/ ([\d.]+)\)|, ([\d.]+)\)/.exec(shadow).slice(1).find(Boolean));
  const depths = {};
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    const [inside, below] = await readShadows();
    expect(inside).toMatch(/ 0\.4px 0\.4px 1px 0px inset$/);
    expect(below).toMatch(/^ ?rgba\(255, 255, 255, [\d.]+\) 0\.4px 0\.4px 0px 0px$/);
    depths[colorScheme] = { shadow: readAlpha(inside), light: readAlpha(below) };
  }
  expect(depths.dark.shadow).toBeGreaterThan(depths.light.shadow);
  expect(depths.dark.light).toBeLessThan(depths.light.light);
});

test("the Finals card has the same outline as every other series", async ({ page }) => {
  await openApp(page);
  const readOutline = (id) =>
    page.locator(`[data-series="${id}"]`).evaluate((card) => {
      const { borderTopColor, borderTopWidth, boxShadow } = getComputedStyle(card);
      return [borderTopColor, borderTopWidth, boxShadow];
    });
  await expect.poll(async () => (await readOutline("1-0"))[1]).toBe("1px");
  expect(await readOutline("3-0")).toEqual(await readOutline("1-0"));
});

test("a round's Best of, in the text face, sits half a pixel above its name's baseline", async ({
  page,
}) => {
  await openApp(page);
  // A zero-size box set in a line of text sits on its baseline.
  const readParts = () =>
    readRoundName(page, 2)
      .locator(":scope > span")
      .evaluateAll((parts) =>
        parts.map((part) => {
          const probe = document.createElement("span");
          probe.style.cssText = "display: inline-block; width: 0; height: 0";
          part.append(probe);
          const baseline = probe.getBoundingClientRect().top;
          probe.remove();
          const font = getComputedStyle(part).fontFamily.split(",")[0].replaceAll('"', "");
          return { baseline, font };
        }),
      );
  await expect.poll(async () => (await readParts())[1]?.font).toBe("Barlow");
  const [name, bestOf] = await readParts();
  expect(name.baseline - bestOf.baseline).toBeCloseTo(0.5, 1);
});

test("a round's Best of sits just after its name", async ({ page }) => {
  await openApp(page);
  await expect(readRoundName(page, 1).locator(".best-of")).toBeVisible();
  const [name, bestOf] = await readRoundName(page, 1)
    .locator(":scope > span")
    .evaluateAll((parts) => parts.map((part) => part.getBoundingClientRect().toJSON()));
  expect(bestOf.left - name.right).toBeCloseTo(10, 0);
});

test("a series' winner has its wins on a teal block, the color of a result, cut through to the floor, its name at the weight of the rest", async ({
  page,
}) => {
  await openApp(page);
  const card = page.locator('[data-series="1-0"]');
  const [won, out] = [card.locator(".team-line.won"), card.locator(".team-line.out")];
  await expect(won).toContainText("Liberty");
  const readBlock = (line) =>
    line.locator(".wins").evaluate((wins) => ({
      face: getComputedStyle(wins, "::after").backgroundColor,
      number: getComputedStyle(wins).color,
    }));
  const readColors = () =>
    page.evaluate(() => {
      const probe = document.createElement("i");
      document.body.append(probe);
      const read = (token) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const colors = { result: read("--teal"), floor: read("--bg") };
      probe.remove();
      return colors;
    });
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    const { result, floor } = await readColors();
    expect(await readBlock(won)).toEqual({ face: result, number: floor });
    expect((await readBlock(out)).face).not.toBe(result);
  }
  const { weight } = await readRole(page, "team-large");
  await expect(won.locator(".club")).toHaveCSS("font-weight", String(weight));
  await expect(out.locator(".club")).toHaveCSS("font-weight", String(weight));
});

test("a series' winner's row is washed in teal, more on Walnut, and its loser's name and wins dim a step beside a dimmer dot", async ({
  page,
}) => {
  await openApp(page);
  const card = page.locator('[data-series="1-0"]');
  const [won, out] = [card.locator(".team-line.won"), card.locator(".team-line.out")];
  await expect(won).toContainText("Liberty");
  const readWash = (percent) =>
    page.evaluate((share) => {
      const probe = document.createElement("i");
      probe.style.backgroundColor = `color-mix(in srgb, var(--teal) ${share}%, transparent)`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    }, percent);
  for (const [colorScheme, percent] of /** @type {const} */ ([
    ["light", 9],
    ["dark", 12],
  ])) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await expect(won).toHaveCSS("background-color", await readWash(percent));
    await expect(out).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  for (const part of [".team-name", ".wins"]) {
    await expect(out.locator(part)).toHaveCSS("opacity", "0.95");
    await expect(won.locator(part)).toHaveCSS("opacity", "1");
  }
  await expect(out.locator(".dot")).toHaveCSS("opacity", "0.55");
});

test("each team's name sits a pixel above its dot and wins, which stay where they were", async ({
  page,
}) => {
  await openApp(page);
  const row = page.locator('[data-series="1-0"] .team-line[data-team="NYL"]');
  await expect(row).toBeVisible();
  await expect(row.locator(".team-name")).toHaveCSS("translate", "0px -1px");
  for (const part of [".dot", ".wins"])
    await expect(row.locator(part)).toHaveCSS("translate", "none");
});

test("each team's wins sit on a block that casts a shadow on the card", async ({ page }) => {
  await openApp(page);
  const wins = page.locator('[data-series="1-0"] .wins').first();
  await expect(wins).toHaveText("0");
  await expect(wins).toHaveCSS("filter", /drop-shadow/);
  const box = await wins.boundingBox();
  expect([box.width, box.height]).toEqual([27, 28]);
});

test.describe("on a phone's touchscreen", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("a tap anywhere on a team's row in the bracket, beside its name or on its wins, lands on the team's button and opens its sheet", async ({
    page,
  }) => {
    await openApp(page);
    const row = page.locator('[data-series="1-0"] .team-line[data-team="NYL"]');
    await expect(row).toBeVisible();
    const [name, wins] = await Promise.all(
      [row.locator(".team-name"), row.locator(".wins")].map((part) => part.boundingBox()),
    );
    const besideName = { x: (name.x + name.width + wins.x) / 2, y: name.y + name.height / 2 };
    const onWins = { x: wins.x + wins.width / 2, y: wins.y + wins.height / 2 };
    for (const spot of [besideName, onWins]) {
      const target = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.team,
        spot,
      );
      expect(target).toBe("NYL");
    }

    await page.touchscreen.tap(besideName.x, besideName.y);
    await expect(page.locator("#teamSheet #teamTitle")).toHaveText("New York Liberty");
  });
});
