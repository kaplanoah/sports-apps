import { test, expect, findGameButton, openApp, matchPath, NOW } from "./harness.mjs";
import { passTime, setHidden } from "../../../../tests/browser/visibility.mjs";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

const RECORD_MS = 5000;

/** @param {import("@playwright/test").Page} page */
const openSettings = (page) => page.getByRole("button", { name: "Settings", exact: true }).click();

/** @param {import("@playwright/test").Page} page */
const findSwitch = (page) => page.getByRole("switch", { name: "Diagnostics" });

/** @param {import("@playwright/test").Page} page */
const findRecords = (page) => page.locator("#diagnostics");

/** @param {import("@playwright/test").Page} page */
async function turnOnDiagnostics(page) {
  await openSettings(page);
  await findSwitch(page).click();
  await expect(findSwitch(page)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settingsDialog")).toBeHidden();
}

/** @param {import("@playwright/test").Page} page */
async function reloadAndRecord(page) {
  await page.reload();
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  await page.clock.runFor(RECORD_MS + 1000);
}

test("Diagnostics sit past the end of settings, off, with nothing recorded, with no note under their name", async ({
  page,
}) => {
  await openApp(page);

  await openSettings(page);

  await expect(page.locator("#settingsDialog")).toContainText("Noah Kaplan");
  await expect(findSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(findSwitch(page)).not.toBeInViewport();
  await expect(findRecords(page)).toBeHidden();
  await expect(page.locator(".diagnostics-area .control-label")).toHaveText("Diagnostics");
});

test("Diagnostics, once on, start with the app, the release, and its commit, set apart by dots", async ({
  page,
}) => {
  await page.route(matchPath("/version.json"), (route) =>
    route.fulfill({
      json: {
        version: "3.6.0-beta",
        commit: "abc1234",
        builtAt: "2026-10-08T03:14:57Z",
        label: "beta",
      },
    }),
  );
  await openApp(page);

  await turnOnDiagnostics(page);
  await page.reload();
  await openSettings(page);

  await expect(findRecords(page).locator(".diagnostics-release")).toHaveText(
    "WNBA\u2022v3.6.0-beta\u2022abc1234",
  );
});

test("with Diagnostics on, a reload is recorded with its tab, what the store sent, and what each part showed", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);

  await reloadAndRecord(page);
  await openSettings(page);

  const record = findRecords(page).locator(".diagnostics-record").first();
  await expect(record.locator("summary")).toContainText("Bracket");
  await expect(record.locator("summary")).toContainText("Steady");
  await expect(record).toContainText("Store sent seasons/2026");
  await expect(record).toContainText(/Shows .*bracketWrap \d+\/\d+px/);
});

test("a part a sheet slides, whose height falls on a half pixel, is recorded at the height it's laid out at, which the slide doesn't change", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "#stamp { height: 40.5px; overflow: hidden; }";
      document.head.append(style);
    }),
  );

  await page.reload();
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  for (let step = 1; step <= 30; step += 1) {
    await page
      .locator("#stamp")
      .evaluate(
        (stamp, offset) => (stamp.style.transform = `translateY(${offset}px)`),
        step * 0.37,
      );
    await page.clock.runFor(20);
  }
  await page.clock.runFor(RECORD_MS);
  await openSettings(page);

  const record = findRecords(page).locator(".diagnostics-record").first();
  await expect(record).not.toContainText("stamp: height 41 to 40px");
  await expect(record).not.toContainText("stamp: height 40 to 41px");
});

test("a reload's first reading is what the page put back from its last showing, before its code redraws it", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);

  await reloadAndRecord(page);
  await openSettings(page);

  const record = findRecords(page).locator(".diagnostics-record").first();
  await expect(record).toContainText(/Shows .*seasonGames \d+\/\d+px/);
  await expect(record).not.toContainText("seasonGames: text");
  await expect(record).not.toContainText("standingsWrap: text");
});

test("a record ends with where the season's list of days is, where its strip's box sits, the day at its top, and what a tap on it lands on", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await turnOnDiagnostics(page);

  await reloadAndRecord(page);
  await openSettings(page);

  const record = findRecords(page).locator(".diagnostics-record").first();
  await expect(record).toContainText(
    /seasonGames scrolled \d+ of \d+, \d+ tall; strip on 2026-09-30, strip scrolled \d+ of \d+, its box on the strip; 2026-09-30 at the top, first item at .*, opacity 1, a tap there lands on /,
  );
});

test("a reload is recorded with its first paint and when each font file arrived", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);

  await reloadAndRecord(page);
  await openSettings(page);

  const record = findRecords(page).locator(".diagnostics-record").first();
  await expect(record).toContainText(/First (contentful )?paint/);
  await expect(record).toContainText("Font barlow-condensed-600.woff2 arrived");
});

test("a part that empties and fills again while recording is flagged as a dip", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await page.reload();
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  const markup = await page.locator("#bracketWrap").evaluate((wrap) => {
    const shown = wrap.innerHTML;
    wrap.replaceChildren();
    return shown;
  });
  await page.clock.runFor(300);

  await page.locator("#bracketWrap").evaluate((wrap, shown) => {
    wrap.innerHTML = shown;
  }, markup);
  await page.clock.runFor(RECORD_MS);
  await openSettings(page);

  const record = findRecords(page).locator(".diagnostics-record").first();
  await expect(record.locator("summary")).toContainText("Dip");
  await expect(record.locator(".diagnostics-dip")).toContainText(/bracketWrap: text \d+ to 0/);
});

test("a return to the page is recorded with how long it was away", async ({ page }) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await setHidden(page, true);
  await passTime(page, 5 * 60 * 1000);

  await setHidden(page, false);
  await page.clock.runFor(RECORD_MS + 1000);
  await openSettings(page);

  await expect(findRecords(page).locator("summary").first()).toContainText("Back after 5 min");
});

/** @param {import("@playwright/test").Page} page */
const findViewportLog = (page) =>
  findRecords(page).locator(".diagnostics-record", { hasText: "Viewport" });

/**
 * The page reads the viewport on the frame after its resize event, and a slow machine can send that
 * event only after the test has opened a sheet, so the clock moves on once the page has it.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function resizeViewport(page, size) {
  const resize = await page.evaluateHandle(() => ({
    seen: new Promise((resolve) =>
      visualViewport?.addEventListener("resize", () => resolve(true), { once: true }),
    ),
  }));
  await page.setViewportSize(size);
  await resize.evaluate((pending) => pending.seen);
  await page.clock.runFor(100);
}

test("with Diagnostics on, the viewport is logged as the page opens, and again when it changes", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);

  await resizeViewport(page, { width: 390, height: 700 });
  await openSettings(page);

  const lines = findViewportLog(page).locator("li");
  await expect(findViewportLog(page).locator("summary")).toContainText("Steady");
  await expect(lines.first()).toContainText(/layout 700, .*sheet ends 700/);
  const resized = lines.filter({ hasText: "layout 700", hasNotText: "sheet ends" });
  await expect(resized).toContainText(/tab bar ends \d+/);
  await expect(lines.filter({ hasText: "layout 844, visual 844 from 0" })).not.toHaveCount(0);
});

for (const [moved, moveViewport] of [
  ["as the page scrolls", () => scrollTo(0, 1)],
  ["as the visual viewport moves", () => visualViewport?.dispatchEvent(new Event("scroll"))],
]) {
  test(`a visual viewport out of line with the layout one is flagged as off ${moved}`, async ({
    page,
  }) => {
    await openApp(page);
    await turnOnDiagnostics(page);
    await reloadAndRecord(page);

    await page.evaluate(() =>
      Object.defineProperty(visualViewport, "offsetTop", { configurable: true, get: () => 110 }),
    );
    await page.evaluate(moveViewport);
    await page.clock.runFor(100);
    await openSettings(page);

    const log = findViewportLog(page);
    await expect(log.locator("summary")).toContainText("Off");
    const offBeforeSettings = log.locator(".diagnostics-dip", { hasNotText: "sheet ends" });
    await expect(offBeforeSettings).toContainText("visual 844 from 110");
  });
}

test("with Diagnostics on, the viewport is logged each time the page leaves the screen and comes back, though nothing changed", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);

  await setHidden(page, true);
  await setHidden(page, false);
  await page.clock.runFor(100);
  await openSettings(page);

  const lines = findViewportLog(page).locator("li");
  await expect(lines.first()).toContainText(/sheet ends \d+/);
  await expect(lines.nth(1)).toContainText(/Back: screen \d+, layout 844, /);
  await expect(lines.nth(2)).toContainText(/Left: screen \d+, layout 844, /);
  await expect(lines.nth(3)).toContainText(/Opened: screen \d+, layout 844, /);
});

test("with Diagnostics on, a bounce past the page's top isn't logged", async ({ page }) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);

  await page.evaluate(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => -40 });
    Object.defineProperty(visualViewport, "offsetTop", { configurable: true, get: () => -40 });
    visualViewport?.dispatchEvent(new Event("scroll"));
  });
  await page.clock.runFor(100);
  await page.evaluate(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => 0 });
    Object.defineProperty(visualViewport, "offsetTop", { configurable: true, get: () => 0 });
  });
  await openSettings(page);

  const log = findViewportLog(page);
  await expect(log.locator("li").filter({ hasText: "sheet ends" })).toHaveCount(1);
  await expect(log.locator("li", { hasText: "from -40" })).toHaveCount(0);
});

test("with Diagnostics on, a tap that opens a team's sheet from a game's, the row's steps, and going back are logged", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await (await findGameButton(page, "Game details: Aces at Fever, First Round Game 2")).click();
  const teamButton = page
    .locator("#gameSheet .faceoff")
    .getByRole("button", { name: "Team details: Indiana Fever" });
  await teamButton.click();
  await expect(page.locator("#teamTitle")).toHaveText("Indiana Fever");
  await page
    .locator("#teamSheet")
    .getByRole("button", { name: "Back to Game", exact: true })
    .click();
  await expect(page.locator("#teamSheet")).toBeHidden();
  await page.clock.runFor(2000);
  await page.keyboard.press("Escape");
  await openSettings(page);

  const log = findRecords(page).locator(".diagnostics-record", { hasText: "Sheets" });
  await expect(log).toHaveCount(1);
  await log.locator("summary").click();
  const lines = await log.locator("li").allInnerTexts();
  const steps = lines.toReversed().map((line) => line.replace(/^\S+\s[AP]M\s+/, ""));
  expect(steps).toEqual(
    expect.arrayContaining([
      "open gameSheet over the page",
      "settle on gameSheet",
      expect.stringMatching(/^click at \d+,\d+ on Team details: Indiana Fever$/),
      "open teamSheet over gameSheet",
      "settle on teamSheet",
      expect.stringMatching(/^click at \d+,\d+ on Back to Game$/),
      "let go of teamSheet",
      "settle on gameSheet",
    ]),
  );
});

test("with Diagnostics on, each tap on the Games list's strip and Today is logged, with where it takes the list and when it arrives", async ({
  page,
}) => {
  await openApp(page, { isWholeSeason: true });
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  await turnOnDiagnostics(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator('#seasonGames .day-cell[data-day="2026-09-29"]').tap();
  await page.locator("#seasonGames .go-today").tap();
  await page.locator("#seasonGames .go-today").tap();
  await openSettings(page);

  const log = findRecords(page).locator(".diagnostics-record", { hasText: "Games list" });
  await expect(log).toHaveCount(1);
  await log.locator("summary").click();
  const lines = await log.locator("li").allInnerTexts();
  const steps = lines.toReversed().map((line) => line.replace(/^\S+\s[AP]M\s+/, ""));
  expect(steps).toEqual([
    expect.stringMatching(/^jump to 2026-09-30, list 0 to \d+$/),
    "arrived at 2026-09-30",
    expect.stringMatching(/^touchstart at \d+,\d+ on Tuesday, September 29$/),
    expect.stringMatching(/^touchend at \d+,\d+ on Tuesday, September 29$/),
    expect.stringMatching(/^click at \d+,\d+ on Tuesday, September 29$/),
    expect.stringMatching(/^jump to 2026-09-29, list \d+ to \d+$/),
    "arrived at 2026-09-29",
    expect.stringMatching(/^touchstart at \d+,\d+ on Today$/),
    expect.stringMatching(/^touchend at \d+,\d+ on Today$/),
    expect.stringMatching(/^click at \d+,\d+ on Today$/),
    expect.stringMatching(/^jump to 2026-09-30, list \d+ to \d+$/),
    "arrived at 2026-09-30",
    expect.stringMatching(/^touchstart at \d+,\d+ on Today$/),
    expect.stringMatching(/^touchend at \d+,\d+ on Today$/),
    expect.stringMatching(/^click at \d+,\d+ on Today$/),
    "already on 2026-09-30, less motion, no pulse",
  ]);
});

test("with Diagnostics on, each error the page doesn't catch is logged with where it came from, and each promise it lets fail", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await page.evaluate(() => {
    dispatchEvent(
      new ErrorEvent("error", {
        message: "TypeError: list is null",
        filename: `${location.origin}/key/js/games-view.js`,
        lineno: 12,
        colno: 7,
      }),
    );
    dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: new RangeError("too far"),
      }),
    );
  });
  await openSettings(page);

  const log = findRecords(page).locator(".diagnostics-record", { hasText: "Errors" });
  await log.locator("summary").click();
  const lines = await log.locator("li").allInnerTexts();
  expect(lines.toReversed().map((line) => line.replace(/^\S+\s[AP]M\s+/, ""))).toEqual([
    "TypeError: list is null at games-view.js:12:7",
    "a promise failed: RangeError: too far",
  ]);
});

test("turning Diagnostics off forgets what it recorded", async ({ page }) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);
  await openSettings(page);
  await expect(findRecords(page).locator(".diagnostics-record")).toHaveCount(3);
  await expect(findViewportLog(page)).toHaveCount(1);
  await expect(
    findRecords(page).locator(".diagnostics-record", { hasText: "Games list" }),
  ).toHaveCount(1);

  await findSwitch(page).click();
  await expect(findRecords(page)).toBeHidden();
  await findSwitch(page).click();

  await expect(findRecords(page)).toContainText("Nothing yet");
  await expect(findRecords(page).locator(".diagnostics-record")).toHaveCount(0);
});

test("the report holds every record kept, the one on request and the reload before it, and the viewport log", async ({
  page,
}) => {
  await stubShare(page);
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);
  await openSettings(page);

  await findReportButton(page).click();

  await expect(findReportButton(page)).toHaveText("Shared");
  const [{ text: report }] = await readShares(page);
  expect(report).toMatch(/^Today \d+:\d\d\s[AP]M, On request, Bracket$/m);
  expect(report).toMatch(/^Today \d+:\d\d\s[AP]M, \w+, Bracket$/m);
  expect(report).toMatch(/^\+\d+ Shows /m);
  expect(report).toMatch(/^Viewport\n\d+:\d\d:\d\d\s[AP]M screen \d+, layout 844, /m);
});

test("once it has said Shared, the button offers the report again", async ({ page }) => {
  await stubShare(page);
  await openApp(page);
  await turnOnDiagnostics(page);
  await openSettings(page);
  await findReportButton(page).click();
  await expect(findReportButton(page)).toHaveText("Shared");
  await page.clock.runFor(2000);

  await expect(findReportButton(page)).toHaveText("Share report");
  await findReportButton(page).click();

  await expect(findReportButton(page)).toHaveText("Shared");
  expect(await readShares(page)).toHaveLength(2);
});

test("Share report notes the page as it is, with the sheets open, and shares it at once under a header naming the app, the device, and the store's jobs", async ({
  page,
}) => {
  await stubShare(page);
  await openApp(page);
  await turnOnDiagnostics(page);
  await openSettings(page);

  await findReportButton(page).click();

  await expect(findReportButton(page)).toHaveText("Shared");
  const [{ text: copied }] = await readShares(page);
  expect(copied).toMatch(/^WNBA, /);
  expect(copied).toMatch(/^Device: /m);
  expect(copied).toMatch(/^Runs in the browser$/m);
  expect(copied).toMatch(/^Viewport 390x844 at \d+(\.\d+)?x$/m);
  expect(copied).toMatch(/^Reduced motion on$/m);
  expect(copied).toMatch(/^Theme (dark|light)$/m);
  expect(copied).toMatch(/^Back from the background 0 times since$/m);
  expect(copied).toMatch(/^News job(: no run saved| last ran .*, \d+ requests?)/m);
  expect(copied).toMatch(/^Players job(: no run saved| last ran .*, \d+ requests?)/m);
  expect(copied).toMatch(/^Today \d+:\d\d\s[AP]M, On request, Bracket$/m);
  expect(copied).toMatch(/^\+0 Sheet settingsDialog, shown$/m);
  expect(copied).toMatch(/^\+0 Shows .*bracketWrap \d+\/\d+px/m);
  expect(copied).toMatch(/^\+0 Animations: /m);
});

test("each report notes the page as it is only for itself, and keeps every record of an open", async ({
  page,
}) => {
  await stubShare(page);
  await openApp(page);
  await turnOnDiagnostics(page);
  for (let reload = 0; reload < 4; reload += 1) await reloadAndRecord(page);
  await openSettings(page);
  const records = findRecords(page).locator(".diagnostics-record summary", {
    hasText: /Opened|Reloaded/,
  });
  await expect(records).toHaveCount(4);

  for (let sent = 1; sent <= 3; sent += 1) {
    await findReportButton(page).click();
    await expect(findReportButton(page)).toHaveText("Shared");
    await page.clock.runFor(2000);
  }

  await expect(records).toHaveCount(4);
  await expect(findRecords(page).locator("summary", { hasText: "On request" })).toHaveCount(0);
  const report = (await readShares(page)).at(-1)?.text ?? "";
  expect(report.match(/, On request, /g)).toHaveLength(1);
  expect(report.match(/, (Opened|Reloaded), /g)).toHaveLength(4);
});

test("opening settings reads how the store's jobs last ran, for the report sent from there", async ({
  page,
}) => {
  await stubShare(page);
  const app = await openApp(page);
  await turnOnDiagnostics(page);
  await app.writeDocument("players/status", { ranAt: NOW, requests: 7 });
  await openSettings(page);

  await expect
    .poll(async () => {
      await findReportButton(page).click();
      const shares = await readShares(page);
      return shares.at(-1)?.text;
    })
    .toMatch(/^Players job last ran .*, 7 requests$/m);
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

test("on a phone, Share report shares the report at once, then offers it again", async ({
  page,
}) => {
  await stubShare(page);
  await openApp(page);
  await turnOnDiagnostics(page);
  await openSettings(page);

  const button = findReportButton(page);
  await expect(button).toHaveText("Share report");
  await button.click();

  await expect(button).toHaveText("Shared");
  const shares = await readShares(page);
  expect(shares).toHaveLength(1);
  expect(shares[0].title).toBe("WNBA Diagnostics");
  expect(shares[0].text).toMatch(/^Today \d+:\d\d\s[AP]M, On request, Bracket$/m);
  await page.clock.runFor(2000);
  await expect(button).toHaveText("Share report");
});

test("on a phone whose share fails, Share report copies the report instead", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    navigator.share = () => Promise.reject(new DOMException("Not allowed", "NotAllowedError"));
  });
  await openApp(page);
  await turnOnDiagnostics(page);
  await openSettings(page);

  await findReportButton(page).click();

  await expect(findReportButton(page)).toHaveText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Today \d+:\d\d\s[AP]M, On request, Bracket$/m);
});

test("on a phone, closing the share sheet copies nothing and leaves Share report to tap again", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    navigator.share = () => Promise.reject(new DOMException("Share canceled", "AbortError"));
  });
  await openApp(page);
  await turnOnDiagnostics(page);
  await openSettings(page);
  await page.evaluate(() => navigator.clipboard.writeText("before"));

  await findReportButton(page).click();
  await page.clock.runFor(100);

  await expect(findReportButton(page)).toHaveText("Share report");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test("Copy report copies the report at once, then offers it again", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await stubShare(page);
    await openApp(page);
    await turnOnDiagnostics(page);
    await openSettings(page);

    const button = findReportButton(page);
    await expect(button).toHaveText("Copy report");
    await button.click();

    await expect(button).toHaveText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^WNBA, /);
    expect(copied).toMatch(/^Viewport 1280x800 at \d+(\.\d+)?x$/m);
    expect(copied).toMatch(/^Today \d+:\d\d\s[AP]M, On request, Bracket$/m);
    expect(await readShares(page)).toHaveLength(0);
    await page.clock.runFor(2000);
    await expect(button).toHaveText("Copy report");
  });

  test("the report never holds the page's address, whose path is its key, even where the page itself failed", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await stubShare(page);
    await openApp(page);
    await turnOnDiagnostics(page);
    await page.evaluate((address) => {
      dispatchEvent(
        new ErrorEvent("error", {
          message: "ResizeObserver loop completed with undelivered notifications.",
          filename: address,
        }),
      );
      dispatchEvent(
        new PromiseRejectionEvent("unhandledrejection", {
          promise: Promise.resolve(),
          reason: new TypeError(`Load failed for ${address}`),
        }),
      );
    }, "https://example-subdomain.workers.dev/k3y/");
    await openSettings(page);
    await findReportButton(page).click();
    await expect(findReportButton(page)).toHaveText("Copied");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(
      "ResizeObserver loop completed with undelivered notifications. at page",
    );
    expect(copied).toContain("a promise failed: TypeError: Load failed for page");
    expect(copied).not.toMatch(/k3y|example-subdomain/);
  });
});
