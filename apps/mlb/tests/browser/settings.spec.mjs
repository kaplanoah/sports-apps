import {
  test,
  expect,
  openApp,
  openSettings,
  chooseSeason,
  swipeSheetDown,
  matchPath,
  readColor,
  SEASON_2025,
  buildFixtureSnapshot,
  FINAL_2025_FIXTURE,
} from "./harness.mjs";
import {
  openRanking,
  scrollSettingsToEnd,
  waitForSheetToRise,
  WITH_A_PAST_SEASON,
} from "./settings-sheet.mjs";
import { LAPTOP, PHONE } from "./screen-sizes.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { comeBackTo, setHidden } from "../../../../tests/browser/visibility.mjs";
import { readTopSpacing } from "../../../../tests/browser/sheet-top.mjs";
import { serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { waitForScrollEnd } from "../../../../tests/browser/scroll-end.mjs";
import { readYearGap, readYearTracking } from "../../../../tests/browser/title-row.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("settings leave the page behind them as it is, as every sheet does", async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  const settings = page.locator(SETTINGS);
  await expect(settings).toBeVisible();
  const dim = await settings.evaluate(
    (dialog) => getComputedStyle(dialog, "::backdrop").backgroundColor,
  );
  expect(dim).toBe("rgba(0, 0, 0, 0)");
});

test("settings' header holds its title, its close button, and the room under them alike on a phone and a wide screen", async ({
  page,
}) => {
  const top = page.locator(`${SETTINGS} .sheet-top`);
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await expect(top).toBeVisible();
  const onPhone = await readTopSpacing(top);

  await page.setViewportSize(LAPTOP);

  expect(await readTopSpacing(top)).toEqual(onPhone);
});

test("the sliders button opens settings, and its close button, Escape, or the backdrop closes it", async ({
  page,
}) => {
  await openApp(page, WITH_A_PAST_SEASON);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeHidden();

  await openSettings(page);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Season" })).toHaveValue("2026");
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toBeHidden();

  await openSettings(page);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await openSettings(page);
  await page.mouse.click(5, 5);
  await expect(settings).toBeHidden();
});

test("settings open on a reload show again, with the season, notifications, and Ranking caret, before the page's code arrives", async ({
  page,
}) => {
  await openApp(page, WITH_A_PAST_SEASON);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await openSettings(page);
  await expect(settings.locator("#rankingBtn")).toBeVisible();
  const notifications = settings.locator("#notificationsGroup");
  await expect(notifications).toBeVisible();
  const note = await notifications.locator("#notifyNote").textContent();
  const release = await holdRequests(page, matchPath("/js/app.js"));

  await page.reload({ waitUntil: "commit" });

  await expect(settings).toBeVisible();
  await expect(notifications.locator("#notifyNote")).toHaveText(note);
  await expect(settings.locator("#rankingBtn svg")).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Season" })).toHaveValue("2026");
  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("#bracketWrap")).toContainText("Phillies");
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toBeHidden();
});

test("settings left off the screen two minutes are closed as the page comes back, before it draws, and a reload then opens without them", async ({
  page,
}) => {
  await openApp(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await openSettings(page);
  await expect(settings.locator("#rankingBtn")).toBeVisible();

  await setHidden(page, true);
  await page.clock.runFor(2 * 60_000 - 1000);
  expect(await comeBackTo(page, SETTINGS)).toBe(true);

  await setHidden(page, true);
  await page.clock.runFor(2 * 60_000);
  const release = await holdRequests(page, matchPath("/js/app.js"));
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("#bracketWrap")).toContainText("Phillies");
  await expect(settings).toBeHidden();
  release();
  await page.waitForLoadState("domcontentloaded");
  await expect(settings).toBeHidden();

  await openSettings(page);
  await setHidden(page, true);
  await page.clock.runFor(2 * 60_000);
  expect(await comeBackTo(page, SETTINGS)).toBe(false);
  await expect(settings).toBeHidden();
});

test("the sliders icon takes the stamp's time color and the hover color under a mouse", async ({
  page,
}) => {
  await openApp(page);
  const button = page.getByRole("button", { name: "Settings", exact: true });
  const timeColor = await page.locator("#stamp").evaluate((stamp) => {
    const time = document.createElement("b");
    stamp.append(time);
    const color = getComputedStyle(time).color;
    time.remove();
    return color;
  });

  await expect(button).toHaveCSS("color", timeColor);
  await button.hover();
  await expect(button).toHaveCSS("color", await readColor(page, "--ink-hover"));
});

test("the sliders icon sits close to the stamp", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#stamp")).toBeVisible();

  const stamp = await page.locator("#stamp").boundingBox();
  const icon = await page.locator("#settingsBtn svg").boundingBox();
  const gap = icon.x - (stamp.x + stamp.width);
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThanOrEqual(18);
});

test("on a narrow phone, the icon keeps its distance from the title's year", async ({ page }) => {
  await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await chooseSeason(page, "2025");

  for (const width of [320, 310, 300, 295]) {
    await page.setViewportSize({ width, height: PHONE.height });
    const tag = await page.locator("#titleYear").boundingBox();
    const icon = await page.locator("#settingsBtn svg").boundingBox();
    const isBesideTag = icon.y < tag.y + tag.height;
    if (isBesideTag) expect(icon.x - (tag.x + tag.width)).toBeGreaterThanOrEqual(20);
  }
});

test("a click inside settings leaves it open", async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });

  await settings.getByRole("heading", { name: "Settings" }).click();

  await expect(settings).toBeVisible();
});

test("an earlier season puts its year in the title until the current one is back", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText("MLB");

  await chooseSeason(page, "2025");
  await expect(title).toHaveText("MLB 2025");

  await chooseSeason(page, "2026");
  await expect(title).toHaveText("MLB");
});

test("the year is the title's font and size, lighter, dimmer, and its digits 0.02em apart, 9px from the name", async ({
  page,
}) => {
  await openApp(page, WITH_A_PAST_SEASON);
  await chooseSeason(page, "2025");
  const readLook = (selector) =>
    page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      const { fontFamily, fontSize, letterSpacing, fontWeight, color } = style;
      return { fontFamily, fontSize, letterSpacing, fontWeight, color };
    });

  const title = await readLook("header.top h1");
  const year = await readLook("#titleYear");

  const sameLook = {
    fontWeight: title.fontWeight,
    color: title.color,
    letterSpacing: title.letterSpacing,
  };
  expect({ ...year, ...sameLook }).toEqual(title);
  expect(Number(year.fontWeight)).toBeLessThan(Number(title.fontWeight));
  expect(year.color).not.toBe(title.color);
  expect(await readYearTracking(page)).toBeCloseTo(0.02, 3);
  // Each machine places the space's glyph on its own subpixel grid, so the gap holds to half a pixel.
  expect(await readYearGap(page)).toBeCloseTo(9, 0);
});

test("the year's gap from the name grows with the title when the browser's text is larger", async ({
  page,
}) => {
  await openApp(page, WITH_A_PAST_SEASON);
  await chooseSeason(page, "2025");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "20px";
  });

  expect(await readYearGap(page)).toBeCloseTo(9 * (20 / 16), 0);
});

test("once the World Series is won, the current season's year is in the title too", async ({
  page,
}) => {
  const finished = { ...buildFixtureSnapshot(FINAL_2025_FIXTURE), season: 2026 };
  await openApp(page, { snapshots: { 2026: finished } });

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("MLB 2026");
});

test("at their foot, settings name the release the page came from and when it came out, in the viewer's time, over the copyright, without asking the Worker", async ({
  page,
}) => {
  const served = await serveReleases(page);
  served.isHanging = true;
  await openApp(page);
  await openSettings(page);

  const version = page.locator("#versionNote");
  await expect(version).toHaveText("v2.13.0\u2022Released Sep 27, 8:10 PM");
  await expect(version).toHaveAttribute("title", "Commit abc1234");
  await expect(page.locator(`${SETTINGS} .settings-footer .settings-version`)).toHaveText([
    "v2.13.0\u2022Released Sep 27, 8:10 PM",
    "\u00a9 2026 Noah Kaplan",
  ]);
  await expect(page.locator(`${SETTINGS} .sheet-top`)).not.toContainText("Released");
});

for (const viewport of [PHONE, { width: 1280, height: 900 }])
  test(`at ${viewport.width}px, settings end with the copyright below the page links`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    await openSettings(page);
    const footer = page.locator(`${SETTINGS} .settings-footer > :last-child`);
    await expect(footer).toHaveText("\u00a9 2026 Noah Kaplan");
    await expect(footer).toHaveCSS("text-align", "center");
    const link = await page.locator("#contactBtn").boundingBox();
    const copyright = await footer.boundingBox();
    expect(copyright.y).toBeGreaterThan(link.y + link.height);
  });

test("on a phone, a scroll just past the end of settings rests at their end, with the copyright in full view", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await serveReleases(page);
  await openApp(page);
  await openSettings(page);
  await expect(page.locator("#versionNote")).toBeVisible();
  const settings = page.locator(SETTINGS);

  const copyright = page.getByText("\u00a9 2026 Noah Kaplan");
  const copyrightBottom = await copyright.evaluate((line) => line.getBoundingClientRect().bottom);

  await page.mouse.move(PHONE.width / 2, PHONE.height / 2);
  await waitForScrollEnd(settings, () => page.mouse.wheel(0, copyrightBottom - PHONE.height + 40));

  await expect(copyright).toBeInViewport({ ratio: 1 });
  const distanceToEnd = await settings.evaluate(
    (dialog) =>
      /** @type {HTMLElement} */ (dialog.querySelector(".settings-body")).offsetHeight -
      dialog.scrollTop -
      dialog.clientHeight,
  );
  expect(distanceToEnd).toBeLessThan(1);
});

test("without a release written into the page, settings leave the version out", async ({
  page,
}) => {
  await openApp(page);
  await openSettings(page);

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.locator("#versionNote")).toBeHidden();
});

test("on a phone, settings rise to fill the screen, with their close button level with their title at the top left", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);

  const settings = page.getByRole("dialog", { name: "Settings" });
  const close = await settings.getByRole("button", { name: "Close" }).boundingBox();
  const title = await settings.getByRole("heading", { name: "Settings" }).boundingBox();
  expect([Math.round(close.x), close.width]).toEqual([6, 44]);
  expect(close.y + close.height / 2).toBeCloseTo(title.y + title.height / 2, 0);
  await expect
    .poll(async () => {
      const box = await settings.boundingBox();
      return box && { left: box.x, top: box.y, width: box.width, height: box.height };
    })
    .toEqual({ left: 0, top: 0, width: PHONE.width, height: PHONE.height });
});

const readSheetTop = (page) =>
  page.locator(SETTINGS).evaluate((dialog) => dialog.getBoundingClientRect().top);

test("on a phone, settings rise only when the viewer allows motion", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toHaveCSS("animation-name", "none");

  await settings.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSettings(page);
  await expect(settings).toHaveCSS("animation-name", "sheet-rise");
});

test("on a phone, a slow swipe down far enough closes settings, and a short one springs back", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  const settings = page.getByRole("dialog", { name: "Settings" });

  await swipeSheetDown(page, { target: ".sheet-top", distance: 60, steps: 6, stepMs: 60 });
  await expect(settings).toBeVisible();
  await expect.poll(() => readSheetTop(page)).toBe(0);

  await swipeSheetDown(page, {
    target: ".settings-controls",
    distance: 200,
    steps: 10,
    stepMs: 60,
  });
  await expect(settings).toBeHidden();

  await openSettings(page);
  await expect.poll(() => readSheetTop(page)).toBe(0);
});

test("on a phone, a quick flick down closes settings, and a cancelled swipe springs back", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  const settings = page.getByRole("dialog", { name: "Settings" });

  await swipeSheetDown(page, {
    target: ".sheet-top",
    distance: 200,
    steps: 10,
    stepMs: 20,
    isCancelled: true,
  });
  await expect(settings).toBeVisible();
  await expect.poll(() => readSheetTop(page)).toBe(0);

  await swipeSheetDown(page, { target: ".sheet-top", distance: 70, steps: 2, stepMs: 20 });
  await expect(settings).toBeHidden();
});

test("a drag on a ranking grip never moves the Ranking page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await openRanking(page);
  const ranking = page.locator("#rankingDialog");
  await expect.poll(async () => Math.round((await ranking.boundingBox()).y)).toBe(0);
  await swipeSheetDown(page, { target: "#rankList .grip", distance: 200, steps: 10, stepMs: 30 });
  await expect(ranking).toBeVisible();
  expect(Math.round((await ranking.boundingBox()).y)).toBe(0);
});

test("a ranking's grip is a slider whose keys move its club, VoiceOver's swipe too, keeping focus on it", async ({
  page,
}) => {
  await openApp(page);
  await openSettings(page);
  await openRanking(page);
  const rows = page.locator("#rankList .rank-item");
  const second = await rows.nth(1).getAttribute("data-id");
  const grip = rows.nth(1).getByRole("slider");
  await expect(grip).toHaveAttribute("aria-valuetext", `Ranked 2 of ${await rows.count()}`);
  await grip.focus();

  await page.keyboard.press("ArrowRight");
  await expect(rows.first()).toHaveAttribute("data-id", second);
  const moved = rows.first().getByRole("slider");
  await expect(moved).toBeFocused();
  await expect(moved).toHaveAttribute("aria-valuetext", `Ranked 1 of ${await rows.count()}`);

  await page.keyboard.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("data-id", second);
  await page.keyboard.press("ArrowLeft");
  await expect(rows.nth(1)).toHaveAttribute("data-id", second);
  await expect(rows.nth(1).getByRole("slider")).toBeFocused();
});

test("on a wide screen, settings open as a modal with a close button", async ({ page }) => {
  await openApp(page);
  await openSettings(page);

  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.locator(".sheet-close svg")).toBeVisible();
  expect(
    (await settings.getByText("Close", { exact: true }).boundingBox()).width,
  ).toBeLessThanOrEqual(1);
  const box = await settings.boundingBox();
  const { width } = page.viewportSize();
  expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
});

test("settings open at the top again after scrolling to their end", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await scrollSettingsToEnd(page);
  await page.keyboard.press("Escape");

  await openSettings(page);

  await expect.poll(() => page.locator(SETTINGS).evaluate((dialog) => dialog.scrollTop)).toBe(0);
});

test("on a wide screen, settings run the screen's height, short of its top and bottom", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await openSettings(page);

  const box = await page.locator(SETTINGS).boundingBox();
  expect(box.y).toBe(24);
  expect(box.y + box.height).toBe(LAPTOP.height - 24);
});
