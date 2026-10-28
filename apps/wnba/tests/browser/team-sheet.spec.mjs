import { test, expect, openApp } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { measurePlacedLegend } from "../../../../tests/browser/placed-legend.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { listChipsOffCenter } from "../../../../tests/browser/chip-centering.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("on a phone, a team's sheet", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("sets its name like every team's sheet, its numbers in Barlow Condensed like a game preview's, its text in medium but None yet a step lighter, and its title on the sheet's own color with no line under it, like a game's, with the titles of its nearest games 11.5px under it and its first part 16px under their cards", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator("table.players")).toBeVisible();

    const teamLarge = await readRole(page, "team-large");
    await expect(sheet.locator("#teamTitle")).toHaveCSS("font-weight", String(teamLarge.weight));
    await expect(sheet.locator("#teamTitle")).toHaveCSS("font-size", `${teamLarge.size}px`);
    await expect(sheet.locator("#teamNote")).toHaveCSS("font-weight", "500");
    await expect(sheet.locator(".tape-value").first()).toHaveCSS(
      "font-family",
      /^"Barlow Condensed"/,
    );
    await expect(sheet.locator(".team-titles")).toHaveCSS("font-weight", "500");
    await expect(sheet.locator(".team-titles")).toHaveText("None yet");
    await expect(sheet.locator(".team-titles-none")).toHaveCSS("font-weight", "400");
    await expect(sheet.locator(".team-game").first()).toHaveCSS("font-weight", "500");

    const colors = await sheet.evaluate((dialog) => {
      const readColor = (selector) => getComputedStyle(dialog.querySelector(selector)).color;
      return {
        title: readColor("#teamTitle"),
        titles: readColor(".team-titles"),
      };
    });
    expect(colors.titles).toBe(colors.title);

    const backgrounds = await page.evaluate(() =>
      ["#teamSheet .sheet-top", "#gameSheet .sheet-top", "#teamSheet"].map(
        (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor,
      ),
    );
    const [teamTop, gameTop, sheetColor] = backgrounds;
    const floor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(teamTop).toBe(gameTop);
    expect(teamTop).toBe(floor);
    expect(sheetColor).not.toBe(floor);
    const top = await sheet.locator(".sheet-top").boundingBox();
    const cardTitle = await sheet.locator(".game-card .sheet-part-head").first().boundingBox();
    const cards = await sheet.locator(".game-cards").boundingBox();
    const firstPart = await sheet
      .locator(".team-sheet-body > .sheet-part .sheet-part-head")
      .first()
      .boundingBox();
    expect(cardTitle.y - (top.y + top.height)).toBeCloseTo(11.5, 0);
    expect(firstPart.y - (cards.y + cards.height)).toBeCloseTo(16, 0);
    await expect(sheet.locator(".sheet-top")).toHaveCSS("border-bottom-width", "0px");
    await expect(sheet.locator(".sheet-top")).not.toHaveCSS("box-shadow", "none");
  });
});

test.describe("a team's sheet in each theme", () => {
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    test(`sets the button for the rest of a long list of titles in the orange of a tap, not the teal of its part's title, in ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await openApp(page);
      await openSeasonPart(page, "Standings");
      await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
      const titles = page.locator("#teamSheet .team-titles");
      await expect(titles).toHaveText("None yet");

      // No team has won enough titles yet to show the button, so it stands in one like the sheet's.
      const colors = await titles.evaluate((line) => {
        const button = document.createElement("button");
        button.className = "team-titles-more";
        button.textContent = "and 4 more";
        line.append(button);
        const part = /** @type {HTMLElement} */ (line.closest(".sheet-part"));
        const readColor = (element) => getComputedStyle(element).color;
        const accent = document.createElement("span");
        accent.style.color = "var(--accent)";
        part.append(accent);
        return {
          button: readColor(button),
          head: readColor(/** @type {HTMLElement} */ (part.querySelector("h3"))),
          accent: readColor(accent),
        };
      });
      expect(colors.button).toBe(colors.accent);
      expect(colors.button).not.toBe(colors.head);
    });
  }
});

test.describe("a team's sheet", () => {
  test("a team in the standings opens its sheet, which follows the season as it changes, and its close button closes it", async ({
    page,
  }) => {
    const app = await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="LVA"] .team-open').click();
    const sheet = page.locator("#teamSheet");

    await expect(sheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
    await expect(sheet.locator("#teamNote")).toHaveText("West\u20223 seed\u202231-13");
    await expect(sheet).toContainText("Leading scorers");
    await app.changeSeason((season) => {
      season.standings.find((row) => row.team === "LVA").lastTen = "9-1";
      return season;
    });
    await expect(sheet.locator(".team-form")).toContainText(/Last 10\s*9-1/);

    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
  });

  test("a team's sheet names the sides over its numbers as teams, and sets Last 10 and Streak like its measures", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator("table.players")).toBeVisible();

    const styles = await sheet.evaluate((dialog) => {
      const read = (selector) => {
        const style = getComputedStyle(dialog.querySelector(selector));
        return {
          color: style.color,
          font: `${style.fontFamily} ${style.fontSize} ${style.fontWeight} ${style.letterSpacing} ${style.textTransform}`,
        };
      };
      return {
        measure: read(".team-ranks .player-rank-label"),
        formName: read(".team-form dt"),
        number: read(".team-ranks .player-rank-value"),
        formNumber: read(".team-form dd"),
      };
    });
    expect(styles.formName).toEqual(styles.measure);
    expect(styles.formNumber).toEqual(styles.number);
    await expect(sheet.locator(".team-numbers .tape-teams .club").first()).toHaveCSS(
      "font-size",
      `${(await readRole(page, "team")).size}px`,
    );
  });

  test("a team's next game is marked with a 14px caret, orange on the day it's played like its time", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
    const next = page.locator("#teamSheet .team-game.next");
    const icon = next.locator(".next-game-icon");

    await expect(icon).toHaveCSS("width", "14px");
    await expect(icon).toHaveCSS("height", "14px");
    const when = await next
      .locator(".team-when")
      .evaluate((element) => getComputedStyle(element).color);
    await expect(icon).toHaveCSS("color", when);
  });

  test("a team's playoff games sit 25px apart, a final's score or not, with the team and field names 13px under them and 10px over their first measure", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    const rows = await sheet
      .locator(".team-game")
      .evaluateAll((games) => games.map((game) => game.getBoundingClientRect().toJSON()));
    const names = await sheet.locator(".team-playoffs + .team-numbers .tape-teams").boundingBox();
    const firstMeasure = await sheet
      .locator(".team-playoffs + .team-numbers .player-rank-row")
      .first()
      .boundingBox();

    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((row, index) => Math.round(row.top - rows[index].top))).toEqual([
      25, 25,
    ]);
    expect(Math.round(names.y - rows[2].bottom)).toBe(13);
    expect(Math.round(firstMeasure.y - (names.y + names.height))).toBe(10);
  });

  test("a team's record sits 5px after its name over its numbers, 1px below the middle of the name, in the dim small type of the game sheet's records", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const club = page.locator("#teamSheet .team-numbers .tape-teams .club").first();
    const record = club.locator(".team-record");
    await expect(record).toHaveText("2-0");

    const [nameBox, recordBox] = await club.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(/** @type {Node} */ (element.firstChild));
      return [
        range.getBoundingClientRect().toJSON(),
        element.lastElementChild?.getBoundingClientRect().toJSON(),
      ];
    });
    expect(Math.round(recordBox.left - nameBox.right)).toBe(5);
    expect(
      Math.round(recordBox.top + recordBox.height / 2 - (nameBox.top + nameBox.height / 2)),
    ).toBe(1);
    const detail = await readRole(page, "detail");
    await expect(record).toHaveCSS("font-size", `${detail.size}px`);
    await expect(record).toHaveCSS("font-weight", String(detail.weight + 100));
  });

  test("Last 10 sits 20px under the regular season's ranks, and Streak 14px under Last 10", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    const numbers = await sheet.locator(".team-ranks").last().boundingBox();
    const form = await sheet.locator(".team-form").boundingBox();
    const [lastTen, streak] = await sheet
      .locator(".team-form dd")
      .evaluateAll((values) => values.map((value) => value.getBoundingClientRect().toJSON()));

    expect(Math.round(form.y - (numbers.y + numbers.height))).toBe(20);
    expect(Math.round(streak.top - lastTen.bottom)).toBe(14);
  });

  test("a team's playoff lines and regular-season curves start and end together, 7.5px past their column, with every dot 7.5px, one at a line's end half a pixel past it, and the field's numbers 33px into theirs", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="NYL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator(".team-ranks .player-curve svg").first()).toBeVisible();

    const layout = await sheet.evaluate((dialog) => {
      const edges = (selector) =>
        [...dialog.querySelectorAll(selector)].map((element) => {
          const box = element.getBoundingClientRect();
          const next = /** @type {Element} */ (element.nextElementSibling).getBoundingClientRect();
          return { left: box.left, right: box.right, pastColumn: box.right - (next.left - 10) };
        });
      const others = [...dialog.querySelectorAll(".placed-other")].map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().left - element.getBoundingClientRect().left;
      });
      const dots = [...dialog.querySelectorAll(".placed-line i")].map((dot) => {
        const box = dot.getBoundingClientRect();
        return [box.width, box.height];
      });
      const lineEnd = dialog.querySelector(".placed-line").getBoundingClientRect().right;
      const endDots = [...dialog.querySelectorAll('.placed-line i[style="left: 100%"]')].map(
        (dot) => dot.getBoundingClientRect().right - lineEnd,
      );
      return {
        lines: edges(".placed-line"),
        curves: edges(".team-ranks .player-curve"),
        others,
        dots,
        endDots,
      };
    });
    const ends = [...layout.lines, ...layout.curves];
    expect(ends).toHaveLength(10);
    expect(new Set(ends.map((end) => end.left.toFixed(1))).size).toBe(1);
    expect(new Set(ends.map((end) => end.right.toFixed(1))).size).toBe(1);
    for (const end of ends) expect(end.pastColumn).toBeCloseTo(7.5, 1);
    for (const inset of layout.others) expect(inset).toBeCloseTo(33, 1);
    for (const dot of layout.dots) expect(dot).toEqual([7.5, 7.5]);
    expect(layout.endDots).toHaveLength(4);
    for (const past of layout.endDots) expect(past).toBeCloseTo(0.5, 1);
  });

  test("a team's playoff lines run dashed past the regular season's range, each a whole gap from the solid line, under a legend 20px below the last line, its two lines 11px apart, and 23px over the Regular season title", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator(".placed-legend")).toHaveText(
      "Regular season range for all teamsPlayoffs range, beyond regular season range",
    );

    const layout = await measurePlacedLegend(sheet);
    expect(layout.above).toBeCloseTo(20, 0);
    expect(layout.between).toBeCloseTo(11, 0);
    expect(layout.below).toBeCloseTo(23, 0);
    expect(layout.dashes.length).toBeGreaterThan(0);
    for (const dash of layout.dashes) {
      expect(dash.meets).toBeCloseTo(0, 1);
      expect(dash.isGapFirst).toBe(true);
    }
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listChipsOffCenter(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
  });

  test("a team's sheet is titled with its name, set like every other team's", async ({ page }) => {
    await openApp(page);
    await page.locator('#bracketWrap .team-line[data-team="NYL"]').first().click();
    const title = page.locator("#teamSheet #teamTitle");

    await expect(title).toHaveText("New York Liberty");
    await expect(title).toHaveCSS("font-family", /^"Barlow Condensed"/);
    const teamLarge = await readRole(page, "team-large");
    await expect(title).toHaveCSS("font-weight", String(teamLarge.weight));
    await expect(title).toHaveCSS("text-transform", "none");
    await expect(title).toHaveCSS("font-size", `${teamLarge.size}px`);
  });

  test("a team's name under the pointer shifts its color a little toward the accent, with no underline", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const row = page.locator('#standings-league tr[data-team="LVA"]');
    const name = row.locator(".team-open .team-name");
    const readColor = () => name.evaluate((element) => getComputedStyle(element).color);
    const before = await readColor();
    await name.hover();

    await expect.poll(readColor).not.toBe(before);
    await expect(name).toHaveCSS("text-decoration-line", "none");

    await page.mouse.move(0, 0);
    await expect.poll(readColor).toBe(before);
    const wins = row.locator("td.season").first();
    await wins.scrollIntoViewIfNeeded();
    const box = await wins.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(readColor).not.toBe(before);
  });

  test("an opponent's name in a team's sheet opens that team's sheet in its place", async ({
    page,
  }) => {
    await openApp(page);
    await page.locator('#bracketWrap .team-line[data-team="NYL"]').first().click();
    const sheet = page.locator("#teamSheet");
    await expect(sheet.locator("#teamTitle")).toHaveText("New York Liberty");
    const opponent = sheet.locator(".team-matchup").first().getByRole("button");
    const name = (await opponent.textContent()).replace(", team details", "");

    await opponent.click();
    await expect(sheet.locator("#teamTitle")).toContainText(name);
    await expect(sheet.locator("#teamTitle")).not.toHaveText("New York Liberty");
  });

  test("a team's name in the standings opens its sheet from the keyboard", async ({ page }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const fever = page.locator("#standings-league").getByRole("button", {
      name: /^Fever\b.*team details$/,
    });
    await fever.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("#teamSheet #teamTitle")).toHaveText("Indiana Fever");
  });

  test("redrawing the standings each minute keeps keyboard focus on the team it was on", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const aces = page.locator("#standings-league").getByRole("button", {
      name: /^Aces\b.*team details$/,
    });
    await aces.focus();

    await page.clock.runFor(60 * 1000);
    await expect(aces).toBeFocused();
  });
});

test("a team's leading scorers set their shooting and minutes a step back, a smaller step in Walnut", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await page.locator('#standings-league tr[data-team="ATL"] .team-open').click();
  const quiet = page
    .locator("#teamSheet table.players tbody tr:not(.players-head)")
    .first()
    .locator("td.quiet-stat");
  await expect(quiet).toHaveText(["46.2", "32.6"]);
  const minutes = quiet.last();
  await expect(page.locator("#teamSheet table.players .first-name").first()).toHaveCSS(
    "margin-right",
    "1px",
  );
  const readColors = () =>
    minutes.evaluate((cell) => {
      const probe = document.createElement("span");
      cell.closest("dialog")?.append(probe);
      /** @param {string} token */
      const readToken = (token) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const colors = {
        minutes: getComputedStyle(cell).color,
        dim: readToken("--ink-dim"),
        mid: readToken("--ink-mid"),
      };
      probe.remove();
      return colors;
    });

  for (const [theme, token] of /** @type {const} */ ([
    ["light", "dim"],
    ["dark", "mid"],
  ])) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const colors = await readColors();
    expect(colors.minutes, theme).toBe(colors[token]);
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("a team's leading scorers keep their names on one line, and its numbers fit their sides", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    const sheet = page.locator("#teamSheet");
    for (const code of ["LVA", "LAS", "CON", "CHI"]) {
      await page.locator(`#standings-league tr[data-team="${code}"] .team-open`).click();
      const names = sheet.locator('table.players th[scope="row"]');
      await expect(names).toHaveCount(5);
      const lineCounts = await names.evaluateAll((cells) =>
        cells.map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.bottom))).size;
        }),
      );
      expect(lineCounts, code).toEqual([1, 1, 1, 1, 1]);
      const overflowing = await sheet
        .locator(".tape-side")
        .evaluateAll((sides) =>
          sides
            .filter((side) => side.scrollWidth > side.clientWidth)
            .map((side) => side.textContent),
        );
      expect(overflowing, code).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
  });
});
