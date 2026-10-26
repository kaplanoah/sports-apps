import { checkSelectArrow } from "./settings.mjs";
import { matchPath } from "./harness.mjs";
import { holdRequests } from "./hold-requests.mjs";
import { showTheme, listThemeLayoutChanges } from "./theme-layout.mjs";
import { listLowContrastText } from "./contrast.mjs";
import { listTextOffRoles, measureFieldFace } from "./type-roles.mjs";
import { PUSH_STUB, stubPushManager } from "./push-stub.mjs";

/** @param {any} test @param {any} expect @param {{ openApp: Function, openSettings: Function, openLockedApp: Function, game: string, updates: string, timing: string, timingSize: number }} app */
export function testGameReminderSettings(test, expect, app) {
  test.use({ serviceWorkers: "allow", contextOptions: { reducedMotion: "reduce" } });

  test("reminders, alerts and timing persist independently on this device", async ({ page }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await app.openSettings(page);
    const reminders = page.getByRole("switch", { name: "Game starts", exact: true });
    const updates = page.getByRole("switch", { name: app.updates, exact: true });
    const timing = page.getByLabel(app.timing, { exact: true });
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
    const synced = page.waitForResponse(matchPath("/push/preferences"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await (await synced).finished();
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
    for (const name of [app.updates, "Game starts"]) {
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
    const reminders = page.getByRole("switch", { name: "Game starts", exact: true });
    await reminders.click();
    await expect(page.locator("#notifyNote")).toContainText("Couldn't change notifications");
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel(app.timing, { exact: true })).toBeEnabled();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(reminders).toHaveAttribute("aria-checked", "true");
  });

  test("a permission reset turns the displayed category on with a fresh user gesture", async ({
    page,
  }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await app.openSettings(page);
    const reminders = page.getByRole("switch", { name: "Game starts", exact: true });
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
    await expect(group.getByText("Game starts", { exact: true })).toHaveCount(0);
    await expect(group.getByLabel(app.timing, { exact: true })).toHaveCount(0);
  });

  test("reminder search words open their timing control on a device that supports push", async ({
    page,
  }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await page.getByRole("tab", { name: "Search", exact: true }).click();
    const input = page.locator("#gameSearch .search-input");
    const row = page.locator("#gameSearch .search-suggestion").filter({ hasText: "Game starts" });
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

  test("turning off the last category treats a missing server device as already removed", async ({
    page,
  }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await app.openSettings(page);
    const reminders = page.getByRole("switch", { name: "Game starts", exact: true });
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await page.route("**/push/preferences", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 404,
            json: { error: { code: "not_found", message: "Device gone" } },
          })
        : route.fallback(),
    );
    let subscriptionWrites = 0;
    await page.route("**/push/subscription", (route) => {
      subscriptionWrites++;
      return route.fallback();
    });
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await expect(reminders).toBeEnabled();
    await expect(page.locator("#notifyNote")).toBeEmpty();
    expect(subscriptionWrites).toBe(0);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), PUSH_STUB.keptKey)).toBeNull();
    await page.unroute("**/push/preferences");
    await page.unroute("**/push/subscription");
    const updates = page.getByRole("switch", { name: app.updates, exact: true });
    await updates.click();
    await expect(updates).toHaveAttribute("aria-checked", "true");
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("device-notifications")),
    );
    expect(stored.updates).toBe(true);
    expect(stored.reminders).toBe(false);
  });

  test("a missing timing record rejected by a full store leaves this device off with guidance", async ({
    page,
  }) => {
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await app.openApp(page);
    await app.openSettings(page);
    const reminders = page.getByRole("switch", { name: "Game starts", exact: true });
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await page.route("**/push/preferences", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 404,
            json: { error: { code: "not_found", message: "Device gone" } },
          })
        : route.fallback(),
    );
    await page.route("**/push/subscription", (route) =>
      route.fulfill({
        status: 429,
        json: { error: { code: "too_many_devices", message: "Full" } },
      }),
    );
    const timing = page.getByLabel(app.timing, { exact: true });
    await timing.selectOption("60");
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await expect(timing).toBeDisabled();
    await expect(timing).toHaveValue("60");
    await expect(page.locator("#notifyNote")).toContainText("Too many devices");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), PUSH_STUB.keptKey)).toBeNull();
    await page.unroute("**/push/preferences");
    await page.unroute("**/push/subscription");
    const updates = page.getByRole("switch", { name: app.updates, exact: true });
    await updates.click();
    await expect(updates).toHaveAttribute("aria-checked", "true");
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("device-notifications")),
    );
    expect(stored.updates).toBe(true);
    expect(stored.reminders).toBe(false);
  });

  for (const source of ["a category edit", "a return visit"])
    test(`a capacity rejection during ${source} clears prior categories before another opt-in`, async ({
      page,
    }) => {
      await page.addInitScript(stubPushManager, PUSH_STUB);
      await app.openApp(page);
      await app.openSettings(page);
      const reminders = page.getByRole("switch", { name: "Game starts", exact: true });
      const updates = page.getByRole("switch", { name: app.updates, exact: true });
      await reminders.click();
      await expect(reminders).toHaveAttribute("aria-checked", "true");
      await page.route("**/push/subscription", (route) =>
        route.fulfill({
          status: 429,
          json: { error: { code: "too_many_devices", message: "Full" } },
        }),
      );
      if (source === "a category edit") {
        await page.route("**/push/preferences", (route) =>
          route.request().method() === "PUT"
            ? route.fulfill({
                status: 404,
                json: { error: { code: "not_found", message: "Gone" } },
              })
            : route.fallback(),
        );
        await updates.click();
      } else {
        const rejected = page.waitForResponse(matchPath("/push/subscription"));
        await page.reload({ waitUntil: "domcontentloaded" });
        await (await rejected).finished();
      }
      await expect(page.locator("#notifyNote")).toContainText("Too many devices");
      await expect(reminders).toHaveAttribute("aria-checked", "false");
      await expect(updates).toHaveAttribute("aria-checked", "false");
      await page.unroute("**/push/preferences");
      await page.unroute("**/push/subscription");
      await updates.click();
      await expect(updates).toHaveAttribute("aria-checked", "true");
      await expect(reminders).toHaveAttribute("aria-checked", "false");
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
        if (!document.getElementById("tab-games")) return;
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
      const reminders = page.getByRole("switch", { name: "Game starts", exact: true });
      await reminders.click();
      await expect(reminders).toHaveAttribute("aria-checked", "true");
      expect(await listThemeLayoutChanges(page)).toEqual([]);
      for (const theme of /** @type {const} */ (["light", "dark"])) {
        await showTheme(page, theme);
        expect(await listLowContrastText(page)).toEqual([]);
        expect(await listTextOffRoles(page)).toEqual([]);
        const face = await measureFieldFace(page.locator("#reminderTiming"), "--type-detail-size");
        expect(face.field).toBeCloseTo(face.role, 0);
        const layout = await page.locator("#notifyRow").evaluate(async (group) => {
          const start = group.querySelector("#remindersTitle");
          const timing = group.querySelector(".reminder-timing");
          const updates = group.querySelector("#notifyTitle").closest(".control-row");
          const picker = group.querySelector("select");
          const pickerStyle = getComputedStyle(picker);
          await document.fonts.load(
            pickerStyle.font,
            [...picker.options].map((option) => option.text).join(" "),
          );
          const probe = document.createElement("span");
          probe.style.position = "absolute";
          probe.style.width = "max-content";
          probe.style.font = pickerStyle.font;
          probe.style.whiteSpace = "pre";
          document.body.append(probe);
          const widestPreset = Math.max(
            ...[...picker.options].map((option) => {
              probe.textContent = option.text;
              return probe.getBoundingClientRect().width;
            }),
          );
          probe.remove();
          const textWidth =
            picker.clientWidth -
            parseFloat(pickerStyle.paddingLeft) -
            parseFloat(pickerStyle.paddingRight);
          const bounds = (element) => element.getBoundingClientRect();
          const style = getComputedStyle(timing);
          const labelStyle = getComputedStyle(timing.querySelector(".control-label"));
          const groupStyle = getComputedStyle(group);
          return {
            startsFirst:
              bounds(start).top < bounds(timing).top && bounds(timing).top < bounds(updates).top,
            indent: bounds(timing.querySelector(".control-label")).left - bounds(start).left,
            mainHeights: [start.closest(".control-row"), updates].map((row) => bounds(row).height),
            timingHeight: bounds(timing).height,
            timingMargin: style.marginTop,
            updatesGap: bounds(updates).top - bounds(timing).bottom,
            labelSize: parseFloat(labelStyle.fontSize),
            isMuted: labelStyle.color === getComputedStyle(group.querySelector("h3")).color,
            presetWidth: widestPreset,
            textWidth,
            pickerWidth: bounds(picker).width,
            pickerHeight: bounds(picker).height,
            pickerOutline: getComputedStyle(picker).borderTopStyle,
            pickerAppearance: getComputedStyle(picker).appearance,
            groupFill: groupStyle.backgroundColor,
            groupOutline: groupStyle.outlineStyle,
            rowBorders: [...group.querySelectorAll(".control-row")].map(
              (row) => getComputedStyle(row).borderTopStyle,
            ),
          };
        });
        expect(layout.startsFirst).toBe(true);
        expect(layout.indent).toBe(16);
        expect(layout.mainHeights.every((height) => height >= 56)).toBe(true);
        expect(layout.timingHeight).toBe(48);
        expect(layout.timingMargin).toBe("-8px");
        expect(layout.updatesGap).toBe(6);
        expect(layout.labelSize).toBe(app.timingSize);
        expect(layout.isMuted).toBe(true);
        expect(layout.presetWidth).toBeLessThanOrEqual(layout.textWidth);
        expect(layout.pickerWidth).toBe(145);
        expect(layout.pickerHeight).toBeGreaterThanOrEqual(40);
        expect(layout.pickerOutline).toBe("solid");
        await checkSelectArrow(page.locator("#reminderTiming"));
        expect(layout.pickerAppearance).toBe("none");
        expect(layout.groupFill).toBe("rgba(0, 0, 0, 0)");
        expect(layout.groupOutline).toBe("none");
        expect(layout.rowBorders).toEqual(["none", "none", "none"]);
        await page.screenshot({ path: testInfo.outputPath(`settings-${screen}-${theme}.png`) });
      }
    });
  }
}
