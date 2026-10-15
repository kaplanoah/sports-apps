import { test, expect, openApp, openSettings } from "./harness.mjs";
import { LAPTOP, PHONE } from "./screen-sizes.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/** @param {import("@playwright/test").Page} page */
const findSwitch = (page) => page.getByRole("switch", { name: "Diagnostics" });

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} distance
 */
async function scrollSettings(page, distance) {
  const settings = page.locator("#settingsDialog");
  await settings.evaluate((dialog) =>
    dialog.addEventListener("scrollend", () => dialog.setAttribute("data-scrolled", ""), {
      once: true,
    }),
  );
  await page.mouse.wheel(0, distance);
  await expect(settings).toHaveAttribute("data-scrolled");
  await settings.evaluate((dialog) => dialog.removeAttribute("data-scrolled"));
}

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
  await expect(findSwitch(page)).not.toBeInViewport();

  await scrollSettings(page, 2000);
  await expect(findSwitch(page)).toBeInViewport();
  await expect(findSwitch(page)).toHaveAttribute("aria-checked", "false");
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
  await expect(findSwitch(page)).not.toBeInViewport();
  await page.mouse.move(LAPTOP.width / 2, LAPTOP.height / 2);

  await scrollSettings(page, 600);

  await expect(findSwitch(page)).toBeInViewport();
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
    await findSwitch(page).click();
    await expect(findSwitch(page)).toHaveAttribute("aria-checked", "true");

    const button = findReportButton(page);
    await expect(button).toHaveText("Share report");
    await button.click();

    await expect(button).toHaveText("Shared");
    const [{ text: copied }] = await readShares(page);
    expect(copied).toMatch(/^Pitchers job(: no run saved| last ran .*, \d+ requests?)/m);
  });
});

/**
 * Opens the Games tab on the whole season, with Diagnostics on.
 * @param {import("@playwright/test").Page} page
 */
async function openSeasonGamesLogging(page) {
  await page.setViewportSize(PHONE);
  const app = await openApp(page, { isWholeSeason: true });
  await openSettings(page);
  await findSwitch(page).click();
  await expect(findSwitch(page)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settingsDialog")).toBeHidden();
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
