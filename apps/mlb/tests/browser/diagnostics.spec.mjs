import { holdClock } from "../../../../tests/browser/harness.mjs";
import { test, expect, openApp, openSettings } from "./harness.mjs";
import { LAPTOP, PHONE } from "./screen-sizes.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { findSeasonPart, scrollSeasonPart } from "../../../../tests/browser/season-scroll.mjs";
import { waitForScrollEnd } from "../../../../tests/browser/scroll-end.mjs";
import { sendClick, sendFinger } from "../../../../tests/browser/stray-click.mjs";
import {
  findDiagnosticsSwitch,
  turnOnDiagnostics,
} from "../../../../tests/browser/diagnostics-switch.mjs";
import { showDipAndOffViewport } from "../../../../tests/browser/diagnostics-records.mjs";
import { listLowContrastTextWithRowsPressed } from "../../../../tests/browser/contrast.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";
import { serveReleases } from "../../../../tests/browser/serve-releases.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} distance
 */
const scrollSettings = (page, distance) =>
  waitForScrollEnd(page.locator(SETTINGS), () => page.mouse.wheel(0, distance));

test("on a phone, Diagnostics sit past the copyright, a scroll beyond where settings rest, off, with no note under their name", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await page.mouse.move(PHONE.width / 2, PHONE.height / 2);

  const copyright = page.getByText("\u00a9 2026 Noah Kaplan");
  const copyrightBottom = await copyright.evaluate((line) => line.getBoundingClientRect().bottom);

  await scrollSettings(page, copyrightBottom - PHONE.height + 40);
  await expect(copyright).toBeInViewport({ ratio: 1 });
  await expect(findDiagnosticsSwitch(page)).not.toBeInViewport();

  await scrollSettings(page, 2000);
  await expect(findDiagnosticsSwitch(page)).toBeInViewport();
  await expect(findDiagnosticsSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#diagnostics")).toBeHidden();
  await expect(page.locator(".diagnostics-area .control-label")).toHaveText("Diagnostics");
});

test("on a wide screen, Diagnostics sit under the settings and ranking, a scroll away", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await openSettings(page);
  await expect(page.locator(".rank-frame")).toBeInViewport();
  await expect(findDiagnosticsSwitch(page)).not.toBeInViewport();
  await page.mouse.move(LAPTOP.width / 2, LAPTOP.height / 2);

  await scrollSettings(page, 600);

  await expect(findDiagnosticsSwitch(page)).toBeInViewport();
});

/** @param {import("@playwright/test").Page} page */
const findReportButton = (page) => page.locator("#diagnosticsReport");

/** @param {import("@playwright/test").Page} page */
const stubShare = (page) =>
  page.addInitScript(() => {
    /** @type {ShareData[]} */
    const shares = [];
    Object.defineProperty(window, "diagnosticsShares", { value: shares });
    navigator.share = async (data) => {
      shares.push(data ?? {});
    };
  });

/** @param {import("@playwright/test").Page} page */
const readShares = (page) =>
  page.evaluate(() => /** @type {ShareData[]} */ (Reflect.get(window, "diagnosticsShares")));

test.describe("on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("a report names how the store's pitchers job last ran", async ({ page }) => {
    await stubShare(page);
    await openApp(page);
    await openSettings(page);
    await findDiagnosticsSwitch(page).click();
    await expect(findDiagnosticsSwitch(page)).toHaveAttribute("aria-checked", "true");

    const button = findReportButton(page);
    await expect(button).toHaveText("Share report");
    await button.click();

    await expect(button).toHaveText("Shared");
    const [{ text: copied }] = await readShares(page);
    expect(copied).toMatch(/^Pitchers job(: no run saved| last ran .*, \d+ requests?)/m);
  });

  test("a report says how the store's last update went, on a line after the time", async ({
    page,
  }) => {
    await stubShare(page);
    await openApp(page, {
      store: {
        "live/status": {
          at: "2026-09-25T00:45:00.000Z",
          detail: "MLB answered 503",
          error: "upstream_error",
          write: "",
        },
      },
    });
    await turnOnDiagnostics(page);
    await openSettings(page);
    await findReportButton(page).click();

    await expect(findReportButton(page)).toHaveText("Shared");
    const [{ text: copied }] = await readShares(page);
    expect(copied).toMatch(
      /^Now .*\nUpdates since .*: detail MLB answered 503, error upstream_error$/m,
    );
  });
});

test("Diagnostics, once on, start with the app, the release the page came from, and its commit, set apart by dots, without asking the Worker", async ({
  page,
}) => {
  const served = await serveReleases(page, {
    version: "2.33.0-beta",
    commit: "abc1234",
    builtAt: "2026-09-28T00:10:41Z",
    label: "beta",
  });
  served.isHanging = true;
  await openApp(page);

  await turnOnDiagnostics(page);
  await page.reload();
  await openSettings(page);

  await expect(page.locator("#diagnostics .diagnostics-release")).toHaveText(
    "MLB\u2022v2.33.0-beta\u2022abc1234",
  );
});

test("each record's flag stays as readable as AA asks with its line pressed, in Ball and Night Game", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await turnOnDiagnostics(page);
  await page.reload();
  await expect(page.locator("#standingsWrap tbody tr").first()).toBeVisible();

  await showDipAndOffViewport(page, "#standingsWrap");

  expect(await listLowContrastTextWithRowsPressed(page)).toEqual([]);
});

/**
 * Opens the Games tab on the whole season, with Diagnostics on.
 * @param {import("@playwright/test").Page} page
 */
async function openSeasonGamesLogging(page) {
  await page.setViewportSize(PHONE);
  const app = await openApp(page, { isWholeSeason: true });
  await turnOnDiagnostics(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  return app;
}

/**
 * The lines of a Diagnostics log, oldest first, without their times.
 * @param {import("@playwright/test").Page} page
 * @param {string} title
 */
async function readLog(page, title) {
  await openSettings(page);
  const log = page.locator("#diagnostics .diagnostics-record", { hasText: title });
  await expect(log).toHaveCount(1);
  const lines = await log.locator("li").allTextContents();
  return lines.toReversed().map((line) =>
    line
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\d{1,2}:\d\d:\d\d ?[AP]M ?/, ""),
  );
}

/** @param {import("@playwright/test").Page} page */
const findList = (page) => page.locator("#seasonGames .day-list");

test("with Diagnostics on, each fill of the Games list logs what it drew and where it left the list", async ({
  page,
}) => {
  await openSeasonGamesLogging(page);
  await page.reload();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();

  expect(await readLog(page, "Games list")).toContainEqual(
    expect.stringMatching(
      /^draw \d+ days, from 2026-03-25 to 2026-\d\d-\d\d, starting on 2026-09-24; 2026-09-24 at the top, \d+px down/,
    ),
  );
});

test("with Diagnostics on, a day that changes height as it's drawn whole is logged, with how far it moved the day at the top", async ({
  page,
}) => {
  await openSeasonGamesLogging(page);
  await page.addStyleTag({ content: ".game-list.is-stand-in { height: 10px !important; }" });
  for (let step = 0; step < 6; step += 1) {
    await findList(page).evaluate((list) => list.scrollBy(0, -list.clientHeight));
    await page.clock.runFor(100);
  }

  expect(await readLog(page, "Games list")).toContainEqual(
    expect.stringMatching(
      /^a day changed height as it was drawn: 2026-\d\d-\d\d whole [\d.]+px to [\d.]+px.*, which moved 2026-\d\d-\d\d -?[\d.]+px$/,
    ),
  );
});

test("with Diagnostics on, a strip that doesn't scroll where it's told is logged", async ({
  page,
}) => {
  await openSeasonGamesLogging(page);
  await page.locator("#seasonGames .day-strip").evaluate((strip) => {
    strip.scrollTo = () => {};
    Object.defineProperty(strip, "scrollLeft", { get: () => 0, set: () => {} });
  });
  await page.locator('#seasonGames .day-cell[data-day="2026-09-27"]').click();
  await expect(page.locator('#seasonGames .day-cell[data-day="2026-09-27"]')).toHaveClass(
    /is-chosen/,
  );

  expect(await readLog(page, "Games list")).toContainEqual(
    expect.stringMatching(/^the strip was told to scroll to \d+ but is at 0$/),
  );
});

test("with Diagnostics on, the day a tap sent the list to is logged as it arrives, as its place moves, and as the list leaves it", async ({
  page,
}) => {
  await openSeasonGamesLogging(page);
  await page.locator('#seasonGames .day-cell[data-day="2026-09-27"]').click();
  await expect(page.locator("#seasonGames")).toHaveAttribute("data-held-day", "2026-09-27");
  await expect(page.locator("#seasonGames")).toHaveAttribute("data-held-arrived", "true");
  await findList(page).evaluate((list) => {
    const before = /** @type {HTMLElement} */ (list.querySelector('[data-day="2026-09-26"]'));
    before.style.paddingTop = "100px";
    list.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator("#seasonGames")).not.toHaveAttribute("data-held-day");

  const lines = await readLog(page, "Games list");
  expect(lines).toContain("arrived at 2026-09-27");
  expect(lines).toContainEqual(expect.stringMatching(/^2026-09-27's place moved from \d+ to \d+$/));
  expect(lines).toContainEqual(expect.stringMatching(/^left 2026-09-27, list at \d+$/));
});

test("with Diagnostics on, scrolling the list logs each new day at its top and how the strip follows it", async ({
  page,
}) => {
  await openSeasonGamesLogging(page);
  await findList(page).evaluate((list) => {
    const next = /** @type {HTMLElement} */ (list.querySelector('[data-day="2026-09-25"]'));
    list.scrollTop = next.offsetTop;
  });
  await expect(page.locator('#seasonGames .day-cell[data-day="2026-09-25"]')).toHaveClass(
    /is-chosen/,
  );

  expect(await readLog(page, "Games list")).toContain(
    "top day 2026-09-25, chosen at once: no finger or wheel moved the list",
  );
});

test("with Diagnostics on, a slide of the strip's dates that leaves the strip short of the list's top day is logged", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSeasonGamesLogging(page);
  await page.clock.runFor(2000);
  await page.locator("#seasonGames .day-strip").evaluate((strip) => {
    strip.scrollTo = () => {};
    Object.defineProperty(strip, "scrollLeft", { get: () => 0, set: () => {} });
  });
  // A wheel's turn that moves nothing puts the list in hand, as a finger does.
  await findList(page).evaluate((list) => {
    list.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    const next = /** @type {HTMLElement} */ (list.querySelector('[data-day="2026-09-25"]'));
    list.scrollTop = next.offsetTop;
  });
  // The scroll that starts the slide comes with the browser's next frame, which a slow machine
  // can draw after the clock has moved.
  await expect(page.locator('#seasonGames .day-cell[data-day="2026-09-25"]')).toHaveClass(
    /is-chosen/,
  );
  await page.clock.runFor(1500);
  await expect(page.locator("#seasonGames .strip-lens")).toHaveCount(0);

  const lines = await readLog(page, "Games list");
  expect(lines).toContain("top day 2026-09-25, slide");
  expect(lines).toContainEqual(
    expect.stringMatching(/^the strip was told to scroll to \d+ but is at 0$/),
  );
});

test("with Diagnostics on, a click iOS sends after the browser took a touch on the standings for a scroll isn't logged, since the page drops it first", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await turnOnDiagnostics(page);
  await openSeasonPart(page, "Standings");
  const button = page.locator("#standingsWrap tr[data-team] button").first();
  await expect(button).toBeInViewport();
  await holdClock(page);

  await sendFinger(button, { moves: [12], isCancelled: true });
  expect(await sendClick(button)).toBe(false);

  const lines = await readLog(page, "Standings and bracket");
  expect(lines).toContainEqual(expect.stringMatching(/^touchend on .*team details$/));
  expect(lines).not.toContainEqual(expect.stringMatching(/^click /));
});

test("with Diagnostics on, each touch on the standings logs how far it moved, whether it landed on a list still gliding, whether the page's code took it, whether its pointer was cancelled, and how far the standings scrolled", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await turnOnDiagnostics(page);
  await openSeasonPart(page, "Standings");
  // At its end, the table leaves a swipe left to the pill's next part, the bracket.
  await page
    .locator("#standingsWrap .st-scroll")
    .first()
    .evaluate((table) => table.scrollTo({ left: table.scrollWidth, behavior: "instant" }));
  const row = page.locator("#standingsWrap tr[data-team]").first();
  await expect(row).toBeInViewport();
  const box = /** @type {{ y: number, height: number }} */ (await row.boundingBox());
  const from = { x: PHONE.width / 2, y: box.y + box.height / 2 };

  // A drag too short and too slow to bring in the bracket springs back to the standings.
  await (
    await drag(page, from, { x: -30, y: 3 }, { durationMs: 1000 })
  )();
  await expect(page.locator("#bracketStandingsParts")).not.toHaveAttribute("data-sliding");
  await expect(
    page.locator('#bracketStandingsParts > [data-part="standings"]'),
  ).not.toHaveAttribute("inert");
  await waitForScrollEnd(findSeasonPart(page, "standings"), async () =>
    (await drag(page, from, { y: -200 }))(),
  );
  // The drag, and the flick it ends in, ride the header and settings' button out of sight.
  await scrollSeasonPart(page, "standings", 0);

  const lines = await readLog(page, "Standings and bracket");
  expect(lines).toContainEqual(expect.stringMatching(/^touchstart at \d+,\d+ on .*team details$/));
  expect(lines).toContainEqual(
    expect.stringMatching(
      /^lifted after moving 30 left and 3 down; it landed on a list at rest; the page's code took the touch once it had moved \d+ left( and \d down)?; its pointer wasn't cancelled; the standings didn't scroll$/,
    ),
  );
  expect(lines).toContainEqual(
    expect.stringMatching(
      /^lifted after moving 200 up; it landed on a list at rest; the browser kept the touch; its pointer was cancelled; the standings scrolled \d+px down$/,
    ),
  );
});
