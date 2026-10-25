import { matchPath } from "./harness.mjs";
import { holdRequests } from "./hold-requests.mjs";
import { showTheme, listThemeLayoutChanges } from "./theme-layout.mjs";
import { listLowContrastText } from "./contrast.mjs";
import { listTextOffRoles } from "./type-roles.mjs";
import { PUSH_STUB, stubPushManager } from "./push-stub.mjs";

/** @param {any} test @param {any} expect @param {{ openApp: Function, openSettings: Function, openLockedApp: Function, game: string, updates: string }} app */
export function testGameReminderSettings(test, expect, app) {
  test.use({ serviceWorkers: "allow", contextOptions: { reducedMotion: "reduce" } });

  test("reminders, alerts and timing persist independently on this device", async ({ page }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await app.openSettings(page);
    const reminders = page.getByRole("switch", { name: "Game reminders", exact: true });
    const updates = page.getByRole("switch", { name: app.updates, exact: true });
    const timing = page.getByLabel("Before the game", { exact: true });
    await expect(timing).toHaveValue("15");
    await expect(timing).toBeDisabled();
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await expect(updates).toHaveAttribute("aria-checked", "false");
    await expect(timing).toBeEnabled();
    await timing.focus();
    await timing.selectOption("60");
    await expect(timing).toBeEnabled();
    await expect(timing).toBeFocused();
    await updates.click();
    await expect(updates).toHaveAttribute("aria-checked", "true");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await expect(updates).toHaveAttribute("aria-checked", "true");
    await expect(timing).toBeDisabled();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(updates).toHaveAttribute("aria-checked", "true");
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await expect(timing).toHaveValue("60");
    await updates.click();
    await expect(updates).toHaveAttribute("aria-checked", "false");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await expect(timing).toHaveValue("60");
  });

  test("each category requests permission in the user's click before network work", async ({
    page,
  }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await page.addInitScript(() => {
      const requestPermission = Notification.requestPermission;
      Notification.requestPermission = () => {
        sessionStorage.setItem(
          "test-permission-gesture",
          String(navigator.userActivation.isActive),
        );
        return requestPermission();
      };
    });
    await app.openApp(page);
    await app.openSettings(page);
    for (const name of [app.updates, "Game reminders"]) {
      const toggle = page.getByRole("switch", { name, exact: true });
      await page.evaluate(() => sessionStorage.removeItem("test-permission-gesture"));
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(await page.evaluate(() => sessionStorage.getItem("test-permission-gesture"))).toBe(
        "true",
      );
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
    }
  });

  test("a failed first subscription save can be retried without reloading", async ({ page }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await app.openSettings(page);
    let rejectSave = true;
    await page.route("**/push/subscription", async (route) => {
      if (route.request().method() === "PUT" && rejectSave) {
        rejectSave = false;
        await route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Try again" } },
        });
      } else await route.fallback();
    });
    const reminders = page.getByRole("switch", { name: "Game reminders", exact: true });
    await reminders.click();
    await expect(page.locator("#notifyNote")).toContainText("Couldn't change notifications");
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Before the game", { exact: true })).toBeEnabled();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(reminders).toHaveAttribute("aria-checked", "true");
  });

  test("a permission reset turns the displayed category on with a fresh user gesture", async ({
    page,
  }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await app.openSettings(page);
    const reminders = page.getByRole("switch", { name: "Game reminders", exact: true });
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await page.evaluate(() => sessionStorage.setItem("test-notification-permission", "default"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => Notification.permission)).toBe("granted");
  });

  test("unsupported push keeps its guidance and hides unusable reminder controls", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      delete window.PushManager;
    });
    await app.openApp(page);
    await app.openSettings(page);
    const group = page.getByRole("group", { name: "Notifications", exact: true });
    await expect(group).toContainText("This browser can't show notifications");
    await expect(group.getByRole("switch")).toHaveCount(0);
    await expect(group.getByText("Game reminders", { exact: true })).toHaveCount(0);
    await expect(group.getByLabel("Before the game", { exact: true })).toHaveCount(0);
  });

  test("reminder search words open their timing control on a device that supports push", async ({
    page,
  }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await page.getByRole("tab", { name: "Search", exact: true }).click();
    const input = page.locator("#gameSearch .search-input");
    const row = page
      .locator("#gameSearch .search-suggestion")
      .filter({ hasText: "Game reminders" });
    for (const words of ["remind", "before game", "game notifications"]) {
      await input.fill(words);
      await input.press("Enter");
      await expect(row).toBeVisible();
      await row.click();
      await expect(page.locator("#settingsDialog")).toBeVisible();
      await expect(page.locator("#reminderTiming")).toBeInViewport();
      await page.locator("#settingsDialog .sheet-close").click();
    }
  });

  test("Notifications matches News and timing occupies its own row", async ({ page }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await app.openSettings(page);
    const group = page.getByRole("group", { name: "Notifications", exact: true });
    await expect(group.getByRole("switch")).toHaveCount(2);
    const measured = await page.evaluate(() => {
      const headings = ["notificationsSettingsTitle", "newsSettingsTitle"].map((id) => {
        const style = getComputedStyle(/** @type {HTMLElement} */ (document.getElementById(id)));
        return {
          font: style.font,
          color: style.color,
          transform: style.textTransform,
          spacing: style.letterSpacing,
        };
      });
      const timing = /** @type {HTMLElement} */ (
        document.getElementById("reminderTiming")
      ).getBoundingClientRect();
      const toggle = /** @type {HTMLElement} */ (
        document.getElementById("remindersSwitch")
      ).getBoundingClientRect();
      return { headings, isSeparate: timing.top >= toggle.bottom };
    });
    expect(measured.headings[0]).toEqual(measured.headings[1]);
    expect(measured.isSeparate).toBe(true);
  });
  test("a notification launch opens the game's sheet and an unavailable game falls back to Games", async ({
    page,
  }) => {
    await app.openApp(page);
    await page.getByRole("tab", { name: "Games", exact: true }).click();
    const first = page.locator("#seasonGames [data-game]").first();
    const key = await first.getAttribute("data-game");
    const url = new URL(page.url());
    url.searchParams.set("game", key.split(" ")[0]);
    url.searchParams.set("season", "2026");
    await page.locator("nav.tabs [data-tab]").first().click();
    await app.openSettings(page);
    await page.addInitScript(() => {
      const opened = [];
      Reflect.set(window, "testLaunchDialogs", opened);
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        opened.push(this.id);
        return show.call(this);
      };
      const observer = new MutationObserver(() => {
        if (!document.getElementById("tabBar")) return;
        observer.disconnect();
        requestAnimationFrame(() => {
          Reflect.set(
            window,
            "testFirstPaintTab",
            document.querySelector("nav.tabs [aria-selected=true]")?.getAttribute("data-tab"),
          );
        });
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.goto(url.href);
    await expect(page.locator("#gameSheet")).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "testFirstPaintTab"))).toBe("games");
    expect(await page.evaluate(() => Reflect.get(window, "testLaunchDialogs"))).not.toContain(
      "settingsDialog",
    );
    await expect(page).not.toHaveURL(/game=/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#gameSheet")).toBeVisible();
    url.searchParams.set("game", "999999999999");
    await page.goto(url.href);
    await expect(page.getByRole("tab", { name: "Games", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#sheetDialog")).toBeHidden();
  });

  test("a notification selects Games while a streamed page is still being parsed", async ({
    page,
  }) => {
    await app.openApp(page);
    const url = new URL(page.url());
    const markup = await (await page.request.get(url.href)).text();
    url.searchParams.set("game", app.game);
    url.searchParams.set("season", "2026");
    await page.route("**/?game=**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: markup.replace("</nav>", '</nav><script src="test-parser-pause.js"></script>'),
      }),
    );
    let release = () => {};
    const held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    await page.route(matchPath("/test-parser-pause.js"), async (route) => {
      await held;
      await route.fulfill({ contentType: "text/javascript", body: "" });
    });
    const paused = page.waitForRequest(matchPath("/test-parser-pause.js"));
    const loading = page.goto(url.href, { waitUntil: "domcontentloaded" });
    try {
      await paused;
      await expect(page.locator("#tab-games")).toBeVisible();
      await expect(page.locator("#tab-games")).toHaveAttribute("aria-selected", "true");
    } finally {
      release();
      await loading;
    }
    await expect(page.locator("#gameSheet")).toBeVisible();
  });

  test("a notification's slow season load leaves the rest of page startup working", async ({
    page,
  }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    const url = new URL(page.url());
    url.searchParams.set("game", "123");
    url.searchParams.set("season", "2025");
    const release = await holdRequests(page, matchPath("/store/seasons/2025"));
    const requested = page.waitForRequest(matchPath("/store/seasons/2025"));
    try {
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
      await requested;
      await expect(page.locator("#notifyRow")).not.toHaveAttribute("hidden");
      await expect(page.locator("#notifySwitch")).toBeEnabled();
    } finally {
      release();
    }
    await expect(page).not.toHaveURL(/game=/);
  });

  test("a game's notification intent survives signing in through the access gate", async ({
    page,
  }) => {
    const worker = await app.openLockedApp(page, { accessCode: "TESTONLY" });
    await worker.updateFromWorker();
    const url = new URL(page.url());
    url.searchParams.set("game", app.game);
    url.searchParams.set("season", "2026");
    await page.goto(url.href);
    await page.getByRole("textbox", { name: "Access code" }).fill("TESTONLY");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.locator("#gameSheet")).toBeVisible();
    await expect(page).not.toHaveURL(/game=/);
  });

  for (const [screen, viewport] of Object.entries({
    phone: { width: 390, height: 844 },
    desktop: { width: 1280, height: 900 },
  })) {
    test(`reminder settings preserve both themes on ${screen}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(stubPushManager, PUSH_STUB);
      await app.openApp(page);
      await app.openSettings(page);
      const reminders = page.getByRole("switch", { name: "Game reminders", exact: true });
      await reminders.click();
      await expect(reminders).toHaveAttribute("aria-checked", "true");
      expect(await listThemeLayoutChanges(page)).toEqual([]);
      for (const theme of /** @type {const} */ (["light", "dark"])) {
        await showTheme(page, theme);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listTextOffRoles(page)).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`settings-${screen}-${theme}.png`) });
      }
    });
  }
}
