import { test, expect, openApp } from "./harness.mjs";
import { EASE_HALFWAY_MS, listAnimations } from "../../../../tests/browser/animations.mjs";

// The Dream and Mystics' game, at 7:00 PM, before it starts.
const GAME_ID = "1042600132";

/** @param {any} season */
function startGame(season) {
  const game = season.games.find((each) => each.id === GAME_ID);
  Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
  Object.assign(game.away, { score: 30 });
  Object.assign(game.home, { score: 27 });
  return season;
}

test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("a game that starts changes in place, in the row it's in", async ({ page }) => {
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    const row = page.locator(`[data-game="${GAME_ID}"]`);
    await expect(row).toContainText("7:00");
    const shownRow = await row.elementHandle();

    await app.changeSeason(startGame);

    await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
    expect(await shownRow.evaluate((element) => element.isConnected)).toBe(true);
  });

  test("the bracket keeps its lines when a game that starts redraws it", async ({ page }) => {
    const app = await openApp(page);
    const lines = page.locator("#bracketWrap .bracket-lines path");
    await expect(lines).not.toHaveCount(0);
    const lineCount = await lines.count();

    await app.changeSeason(startGame);

    await expect(page.locator("#bracketWrap .card-note.live")).not.toHaveCount(0);
    await expect(lines).toHaveCount(lineCount);
  });

  test("a game that starts shows its line at once", async ({ page }) => {
    const readAnimations = await listAnimations(page);
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();

    await app.changeSeason(startGame);

    await expect(page.locator(`[data-game="${GAME_ID}"] .game-status`)).toHaveText("Q2 5:10");
    expect(await readAnimations()).toEqual([]);
  });
});

test("a game that starts eases its score to its new height and fades in its new line", async ({
  page,
}) => {
  const readAnimations = await listAnimations(page);
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator(`[data-game="${GAME_ID}"]`)).toContainText("7:00");

  await app.changeSeason(startGame);

  await expect(page.locator(`[data-game="${GAME_ID}"] .game-status`)).toHaveText("Q2 5:10");
  const animations = await readAnimations();
  const growth = animations.find(({ classes }) => classes.includes("score"));
  expect(parseFloat(String(growth.last.height))).toBeGreaterThan(
    parseFloat(String(growth.first.height)),
  );
  expect(growth.first.overflow).toBe("clip");
  expect(animations).toContainEqual({
    classes: ["game-status"],
    first: { opacity: 0 },
    last: { opacity: 1 },
  });
});

test("a redraw that grows a part still fading in fades it the rest of the way as it eases to its new height", async ({
  page,
}) => {
  const readAnimations = await listAnimations(page);
  await openApp(page);

  const halfOpen = await page.evaluate(async (halfway) => {
    const { redrawEased } = await import("#shared/eased-redraw.js");
    const { html, noteHeight, setHtml } = await import("#shared/html.js");
    const part = document.createElement("div");
    part.className = "eased-part";
    document.body.prepend(part);
    redrawEased(() => {
      noteHeight(part);
      setHtml(part, html`<p>One</p>`);
    });
    for (const animation of part.getAnimations()) {
      animation.pause();
      animation.currentTime = halfway;
    }
    const { height, opacity } = getComputedStyle(part);
    redrawEased(() => setHtml(part, html`<p>One</p><p>Two</p>`));
    return { height, opacity };
  }, EASE_HALFWAY_MS);

  const easings = (await readAnimations()).filter(({ classes }) => classes.includes("eased-part"));
  expect(Number(halfOpen.opacity)).toBeLessThan(1);
  const { first, last } = easings.at(-1);
  expect(parseFloat(String(first.height))).toBeCloseTo(parseFloat(halfOpen.height));
  expect(first.opacity).toBe(halfOpen.opacity);
  expect(last.opacity).toBe("1");
});

test("a problem the store reports eases the header to its new height", async ({ page }) => {
  const readAnimations = await listAnimations(page);
  const app = await openApp(page);
  const stamp = page.locator("#stamp");
  await expect(stamp).toContainText("Next tip-off");

  await app.writeDocument("live/status", { error: "upstream_error" });

  await expect(stamp).toContainText("The WNBA isn't answering right now");
  const growth = (await readAnimations()).find(({ classes }) => classes.includes("stamp"));
  expect(parseFloat(String(growth.last.height))).toBeGreaterThan(
    parseFloat(String(growth.first.height)),
  );
});

test("the page draws what it opens with at once, rather than easing it in", async ({ page }) => {
  const readAnimations = await listAnimations(page);

  await openApp(page);

  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  expect(await readAnimations()).toEqual([]);
});

test("a redraw fades in only what's on screen, not the days it adds to a Games list out of sight", async ({
  page,
}) => {
  const readAnimations = await listAnimations(page);

  await openApp(page, { isWholeSeason: true });

  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  expect(await readAnimations()).toEqual([]);
});

test("a redraw of a part holding a select shows the choice its markup names, whatever was picked in it before", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await page.evaluate(async () => {
    const { html, setHtml } = await import("#shared/html.js");
    const part = document.createElement("label");
    part.id = "choicePart";
    document.body.prepend(part);
    /** @type {any} */ (window).drawChoices = (
      /** @type {string[]} */ years,
      /** @type {string} */ shown,
    ) =>
      setHtml(
        part,
        html`<select>
          ${years.map(
            (year) =>
              html`<option value="${year}" ${year === shown ? "selected" : ""}>${year}</option>`,
          )}
        </select>`,
      );
    /** @type {any} */ (window).drawChoices(["2026", "2025", "2024"], "2026");
  });
  const select = page.locator("#choicePart select");
  await select.selectOption("2024");
  await select.selectOption("2025");

  await page.evaluate(() =>
    /** @type {any} */ (window).drawChoices(["2027", "2026", "2025", "2024"], "2025"),
  );

  await expect(select).toHaveValue("2025");
});
