import { holdClock } from "./harness.mjs";
import { PUSH_STUB, stubPushManager, stubPushRegistration } from "./push-stub.mjs";

function holdPermission() {
  Notification.requestPermission = () => {
    Reflect.set(
      window,
      "permissionSwitchWasOn",
      document.querySelector('[aria-busy="true"]')?.getAttribute("aria-checked"),
    );
    return new Promise((resolve, reject) => {
      Reflect.set(window, "finishPermission", (result) => {
        if (result === "failure") reject(new Error("Permission unavailable"));
        else {
          sessionStorage.setItem("test-notification-permission", result);
          resolve(result);
        }
      });
    });
  };
}

const readGeometry = (page) =>
  page.locator("#notificationsGroup").evaluate((group) =>
    [...group.querySelectorAll("h3, .control-row, button, select")].map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );

/** @param {any} test @param {any} expect @param {{ openApp: Function, openSettings: Function }} app */
export function testNotificationPermission(test, expect, app) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  test.beforeEach(async ({ page }) => {
    // Keep the wide bracket's paint cost out of permission checks.
    await page.addInitScript(() => localStorage.setItem("lastTab", "news"));
    await page.addInitScript(stubPushManager, PUSH_STUB);
    await page.addInitScript(stubPushRegistration);
  });
  for (const category of ["reminders", "notify"]) {
    for (const theme of /** @type {const} */ (["light", "dark"]))
      test(`${category} switches on in the tap stack, delays its spinner, and keeps geometry in ${theme}`, async ({
        page,
      }) => {
        test.slow();
        await page.emulateMedia({ colorScheme: theme });
        await app.openApp(page);
        await app.openSettings(page);
        await page.evaluate(holdPermission);
        await holdClock(page);
        const toggle = page.locator(`#${category}Switch`);
        const other = page.locator(category === "notify" ? "#remindersSwitch" : "#notifySwitch");
        const spinner = toggle.locator("..").locator(".notification-spinner");
        const before = await readGeometry(page);
        const requestedInTap = await page.evaluate((category) => {
          document.getElementById(`${category}Switch`).click();
          return typeof Reflect.get(window, "finishPermission") === "function";
        }, category);
        expect(requestedInTap).toBe(true);
        await expect(toggle).toHaveAttribute("aria-checked", "true");
        await expect(toggle).toBeDisabled();
        await expect(other).toHaveAttribute("aria-checked", "false");
        expect(await page.evaluate(() => Reflect.get(window, "permissionSwitchWasOn"))).toBe(
          "true",
        );
        expect(
          await page.evaluate(() => localStorage.getItem("pending-push-preferences")),
        ).toBeNull();
        expect(await page.evaluate(() => localStorage.getItem("device-notifications"))).toBeNull();
        await page.clock.runFor(699);
        await expect(spinner).toBeHidden();
        expect(await readGeometry(page)).toEqual(before);
        await page.clock.runFor(1);
        await expect(spinner).toBeVisible();
        expect(await readGeometry(page)).toEqual(before);
        await expect(page.locator("#notifyNote")).toBeEmpty();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const shape = await spinner.evaluate((element) => {
          const style = getComputedStyle(element);
          const root = getComputedStyle(document.documentElement);
          return {
            width: element.offsetWidth,
            height: element.offsetHeight,
            gap: -element.offsetLeft - element.offsetWidth,
            top: element.offsetTop,
            ring: style.borderTopWidth,
            color: style.borderTopColor,
            track: style.borderRightColor,
            ink: root.getPropertyValue("--ink-dim").trim(),
            divider: root.getPropertyValue("--divider").trim(),
            animation: style.animationName,
            duration: style.animationDuration,
          };
        });
        expect(shape).toMatchObject({
          width: 14,
          height: 14,
          gap: 8,
          top: 7,
          ring: "2px",
          animation: "catch-up-turn",
          duration: "2.4s",
        });
        const colors = await spinner.evaluate((element) => {
          const probe = document.createElement("span");
          element.append(probe);
          probe.style.color = "var(--ink-dim)";
          const ink = getComputedStyle(probe).color;
          probe.style.color = "var(--divider)";
          const divider = getComputedStyle(probe).color;
          probe.remove();
          return { ink, divider };
        });
        expect(shape.color).toBe(colors.ink);
        expect(shape.track).toBe(colors.divider);
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await expect(spinner).toHaveCSS("animation-duration", "0.8s");
        await expect(spinner).toHaveCSS("animation-name", "catch-up-turn");
        await page.evaluate(() => Reflect.get(window, "finishPermission")("granted"));
        await expect(toggle).toBeEnabled();
        await expect(toggle).toHaveAttribute("aria-checked", "true");
        await expect(spinner).toBeHidden();
        expect(await readGeometry(page)).toEqual(before);
        await page.clock.runFor(1000);
        await expect(spinner).toBeHidden();
      });

    for (const result of ["denied", "default", "failure"]) {
      test(`${category} rolls back ${result} without changing the other category`, async ({
        page,
      }) => {
        await app.openApp(page);
        await app.openSettings(page);
        const toggle = page.locator(`#${category}Switch`);
        const other = page.locator(category === "notify" ? "#remindersSwitch" : "#notifySwitch");
        await other.click();
        await expect(other).toBeEnabled();
        await expect(other).toHaveAttribute("aria-checked", "true");
        const saved = await page.evaluate(() => localStorage.getItem("device-notifications"));
        await page.evaluate(holdPermission);
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", "true");
        await expect(toggle).toBeDisabled();
        await page.evaluate((answer) => Reflect.get(window, "finishPermission")(answer), result);
        await expect(toggle).toBeEnabled();
        await expect(toggle).toHaveAttribute("aria-checked", "false");
        await expect(other).toHaveAttribute("aria-checked", "true");
        expect(await page.evaluate(() => localStorage.getItem("device-notifications"))).toBe(saved);
        await expect(page.locator(".notification-spinner:visible")).toHaveCount(0);
        if (result === "denied") await expect(page.locator("#notifyNote")).toContainText("blocked");
        if (result === "failure")
          await expect(page.locator("#notifyNote")).toContainText("Couldn't change");
        if (result === "default") await expect(page.locator("#notifyNote")).toBeEmpty();
      });
    }
  }

  for (const result of ["granted", "denied", "default", "failure"])
    test(`choosing a time enables reminders directly and handles ${result}`, async ({ page }) => {
      await app.openApp(page);
      await app.openSettings(page);
      const updates = page.locator("#notifySwitch");
      if (result !== "granted") {
        await updates.click();
        await expect(updates).toBeEnabled();
      }
      await page.evaluate(holdPermission);
      const timing = page.locator("#reminderTiming");
      await expect(timing).toBeEnabled();
      await expect(timing).toHaveValue("");
      const direct = await timing.evaluate((element) => {
        element.value = "180";
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return typeof Reflect.get(window, "finishPermission") === "function";
      });
      expect(direct).toBe(true);
      await expect(page.locator("#remindersSwitch")).toHaveAttribute("aria-checked", "true");
      await expect(timing).toHaveValue("180");
      const before = await page.evaluate(() => localStorage.getItem("device-notifications"));
      if (before) expect(JSON.parse(before).reminders).toBe(false);
      await page.evaluate((answer) => Reflect.get(window, "finishPermission")(answer), result);
      await expect(page.locator("#remindersSwitch")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator("#remindersSwitch")).toHaveAttribute(
        "aria-checked",
        String(result === "granted"),
      );
      await expect(updates).toHaveAttribute("aria-checked", String(result !== "granted"));
      await expect(timing).toHaveValue(result === "granted" ? "180" : "");
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("device-notifications")),
      );
      expect(stored.reminders).toBe(result === "granted");
      expect(stored.minutes).toBe(result === "granted" ? 180 : 10);
    });

  test("timing completion restores keyboard focus without activating a touch picker", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    await page.locator("#remindersSwitch").click();
    await expect(page.locator("#remindersSwitch")).toBeEnabled();
    for (const keyboard of [false, true]) {
      await page.evaluate((keyboard) => document.body.classList.toggle("kbd", keyboard), keyboard);
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/push/preferences", async (route) => {
        await held;
        await route.fallback();
      });
      const timing = page.locator("#reminderTiming");
      await timing.focus();
      await timing.evaluate((element) => {
        Reflect.set(window, "timingFocusCalls", 0);
        const focus = element.focus.bind(element);
        element.focus = (options) => {
          Reflect.set(window, "timingFocusCalls", Reflect.get(window, "timingFocusCalls") + 1);
          focus(options);
        };
      });
      await timing.selectOption(keyboard ? "30" : "60");
      await expect(timing).toBeEnabled();
      await page.locator("#settingsDialog").focus();
      release();
      await expect(page.locator("#remindersSwitch")).toBeEnabled();
      await expect(timing).toBeEnabled();
      expect(await page.evaluate(() => Reflect.get(window, "timingFocusCalls"))).toBe(
        keyboard ? 1 : 0,
      );
      await page.unroute("**/push/preferences");
      await timing.evaluate((element) => {
        Reflect.deleteProperty(element, "focus");
      });
    }
  });

  test("fast completion never shows a spinner and timing saves have no category feedback", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    await holdClock(page);
    const toggle = page.locator("#remindersSwitch");
    await toggle.click();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.clock.runFor(1000);
    await expect(page.locator(".notification-spinner:visible")).toHaveCount(0);
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/push/preferences", async (route) => {
      await held;
      await route.fallback();
    });
    try {
      await page.locator("#reminderTiming").selectOption("180");
      await expect(page.locator("#reminderTiming")).toBeEnabled();
      await page.clock.runFor(1000);
      await expect(page.locator(".notification-spinner:visible")).toHaveCount(0);
      await expect(toggle).toHaveAttribute("aria-busy", "false");
      await page.locator("#reminderTiming").selectOption("30");
      await page.locator("#reminderTiming").selectOption("60");
      await expect(page.locator("#reminderTiming")).toHaveValue("60");
      await page.locator("#reminderTiming").evaluate((element) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "selectedIndex",
        );
        Reflect.set(window, "timingSelectionWrites", 0);
        Reflect.set(window, "keptTimingElement", element);
        Object.defineProperty(element, "selectedIndex", {
          get() {
            return descriptor.get.call(this);
          },
          set(value) {
            Reflect.set(
              window,
              "timingSelectionWrites",
              Reflect.get(window, "timingSelectionWrites") + 1,
            );
            descriptor.set.call(this, value);
          },
        });
      });
    } finally {
      release();
    }
    await expect(toggle).toBeEnabled();
    await expect(page.locator("#reminderTiming")).toBeEnabled();
    await expect(page.locator("#reminderTiming")).toHaveValue("60");
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("device-notifications")).minutes === 60,
    );
    expect(await page.evaluate(() => Reflect.get(window, "timingSelectionWrites"))).toBe(0);
    expect(
      await page
        .locator("#reminderTiming")
        .evaluate((element) => element === Reflect.get(window, "keptTimingElement")),
    ).toBe(true);
  });

  for (const result of ["denied", "failure"])
    test(`pending retry does not overlap ${result} guidance or move its rows on a phone`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await app.openApp(page);
      await app.openSettings(page);
      await page.locator("#remindersSwitch").click();
      await expect(page.locator("#remindersSwitch")).toBeEnabled();
      await page.evaluate(holdPermission);
      const toggle = page.locator("#notifySwitch");
      await toggle.click();
      await page.evaluate((result) => Reflect.get(window, "finishPermission")(result), result);
      await expect(toggle).toBeEnabled();
      await expect(page.locator("#notifyNote")).not.toBeEmpty();
      await holdClock(page);
      const before = await readGeometry(page);
      await toggle.click();
      await page.clock.runFor(700);
      await expect(toggle.locator("..").locator(".notification-spinner")).toBeVisible();
      expect(await readGeometry(page)).toEqual(before);
      const overlap = await page.locator("#notifyNote").evaluate((note) => {
        const shell = document.getElementById("notifySwitch").parentElement;
        const spinner = /** @type {HTMLElement} */ (shell.querySelector(".notification-spinner"));
        const bounds = shell.getBoundingClientRect();
        const left = bounds.left + spinner.offsetLeft;
        const top = bounds.top + spinner.offsetTop;
        const ring = {
          left,
          right: left + spinner.offsetWidth,
          top,
          bottom: top + spinner.offsetHeight,
        };
        const range = document.createRange();
        range.selectNodeContents(note);
        return [...range.getClientRects()].some(
          (text) =>
            text.left < ring.right &&
            text.right > ring.left &&
            text.top < ring.bottom &&
            text.bottom > ring.top,
        );
      });
      expect(overlap).toBe(false);
      await page.evaluate(() => Reflect.get(window, "finishPermission")("default"));
      await expect(toggle).toBeEnabled();
    });
}
