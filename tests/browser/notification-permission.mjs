import { checkSelectArrow } from "./settings.mjs";
import { holdClock, matchPath } from "./harness.mjs";
import { holdRequests } from "./hold-requests.mjs";
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

function watchControlLooks() {
  const looks = [];
  const readSwitch = (id) => {
    const element = document.getElementById(id);
    const style = getComputedStyle(element);
    return {
      opacity: style.opacity,
      look: [style.backgroundColor, style.borderColor, style.cursor].join(" "),
      checked: element.getAttribute("aria-checked"),
      disabled: element.hasAttribute("disabled"),
    };
  };
  const recordLooks = () => {
    const timing = document.getElementById("reminderTiming");
    const timingStyle = getComputedStyle(timing);
    const caretStyle = getComputedStyle(timing.parentElement, "::after");
    looks.push({
      reminders: readSwitch("remindersSwitch"),
      updates: readSwitch("notifySwitch"),
      timing: timingStyle.opacity,
      caret: caretStyle.opacity,
      timingLook: [
        timingStyle.color,
        timingStyle.backgroundColor,
        timingStyle.borderColor,
        caretStyle.backgroundColor,
      ].join(" "),
    });
  };
  const recordEachFrame = () => {
    recordLooks();
    requestAnimationFrame(recordEachFrame);
  };
  new MutationObserver(recordLooks).observe(document.getElementById("notificationsGroup"), {
    subtree: true,
    childList: true,
    attributes: true,
  });
  recordEachFrame();
  Reflect.set(window, "controlLooks", looks);
}

/** @param {any} expect @param {Record<string, string>} checked */
async function expectSteadyLooks(page, expect, checked) {
  const looks = await page.evaluate(() => Reflect.get(window, "controlLooks"));
  expect(looks.some((look) => look.reminders.disabled || look.updates.disabled)).toBe(false);
  for (const look of looks) {
    expect([look.reminders.opacity, look.updates.opacity, look.timing, look.caret]).toEqual([
      "1",
      "1",
      "1",
      "1",
    ]);
    expect(look.timingLook).toBe(looks[0].timingLook);
    for (const [category, state] of Object.entries(checked)) {
      expect(look[category].checked).toBe(state);
      expect(look[category].look).toBe(looks[0][category].look);
    }
  }
}

const PREFERENCES = matchPath("/push/preferences");

/** @param {import("@playwright/test").Route} route */
const failSave = (route) =>
  route.request().method() === "PUT"
    ? route.fulfill({
        status: 503,
        json: { error: { code: "unavailable", message: "The store is busy." } },
      })
    : route.fallback();

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
        await expect(toggle).toBeEnabled();
        await checkSelectArrow(page.locator("#reminderTiming"));
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
        await expect(toggle).toHaveAttribute("aria-busy", "false");
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
        await expect(other).toHaveAttribute("aria-busy", "false");
        await expect(other).toHaveAttribute("aria-checked", "true");
        const saved = await page.evaluate(() => localStorage.getItem("device-notifications"));
        await page.evaluate(holdPermission);
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", "true");
        await expect(toggle).toBeEnabled();
        await page.evaluate((answer) => Reflect.get(window, "finishPermission")(answer), result);
        await expect(toggle).toHaveAttribute("aria-busy", "false");
        await expect(toggle).toHaveAttribute("aria-checked", "false");
        await expect(other).toHaveAttribute("aria-checked", "true");
        expect(await page.evaluate(() => localStorage.getItem("device-notifications"))).toBe(saved);
        await expect(page.locator(".notification-spinner:visible")).toHaveCount(0);
        if (result === "denied") await expect(page.locator("#notifyNote")).toContainText("blocked");
        if (result === "failure") {
          await expect(page.locator(`#${category}Note`)).toContainText("Couldn't update");
          await expect(page.locator("#notificationsGroup .control-note:not(:empty)")).toHaveCount(
            1,
          );
        }
        if (result === "default")
          await expect(page.locator("#notificationsGroup .control-note:not(:empty)")).toHaveCount(
            0,
          );
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
        await expect(updates).toHaveAttribute("aria-busy", "false");
      }
      await page.evaluate(holdPermission);
      const timing = page.locator("#reminderTiming");
      await expect(timing).toBeEnabled();
      await expect(timing).toHaveValue("10");
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
      await expect(timing).toHaveValue(result === "granted" ? "180" : "10");
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("device-notifications")),
      );
      expect(stored.reminders).toBe(result === "granted");
      expect(stored.minutes).toBe(result === "granted" ? 180 : 10);
    });

  test("a timing save leaves focus on the timing, by touch or keyboard, and never moves it", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    const reminders = page.locator("#remindersSwitch");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-busy", "false");
    const timing = page.locator("#reminderTiming");
    for (const [keyboard, minutes] of /** @type {const} */ ([
      [false, 60],
      [true, 30],
    ])) {
      await page.evaluate((keyboard) => document.body.classList.toggle("kbd", keyboard), keyboard);
      const release = await holdRequests(page, PREFERENCES);
      await timing.focus();
      await timing.evaluate((element) => {
        Reflect.set(window, "timingFocusCalls", 0);
        const focus = element.focus.bind(element);
        element.focus = (options) => {
          Reflect.set(window, "timingFocusCalls", Reflect.get(window, "timingFocusCalls") + 1);
          focus(options);
        };
      });
      await timing.selectOption(String(minutes));
      await expect(timing).toBeEnabled();
      await expect(timing).toBeFocused();
      release();
      await page.waitForFunction(
        (minutes) => JSON.parse(localStorage.getItem("device-notifications")).minutes === minutes,
        minutes,
      );
      await expect(timing).toBeFocused();
      expect(await page.evaluate(() => Reflect.get(window, "timingFocusCalls"))).toBe(0);
      await page.unroute(PREFERENCES);
      await timing.evaluate((element) => {
        Reflect.deleteProperty(element, "focus");
      });
    }
  });

  test("a switch tapped again during a slow save shows and saves its newest choice", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    const updates = page.locator("#notifySwitch");
    const reminders = page.locator("#remindersSwitch");
    await updates.click();
    await expect(updates).toHaveAttribute("aria-busy", "false");
    const release = await holdRequests(page, PREFERENCES);
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await updates.click();
    await expect(updates).toHaveAttribute("aria-checked", "false");
    release();
    await expect(reminders).toHaveAttribute("aria-busy", "false");
    await expect(updates).toHaveAttribute("aria-busy", "false");
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await expect(updates).toHaveAttribute("aria-checked", "false");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("device-notifications")),
    );
    expect([stored.reminders, stored.updates]).toEqual([true, false]);
  });

  test("a switch tapped off and on again during a save the store turns away keeps its turned-away note", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    const updates = page.locator("#notifySwitch");
    const release = await holdRequests(page, matchPath("/push/subscription"), {
      answer: (route) =>
        route.fulfill({
          status: 429,
          json: { error: { code: "too_many_devices", message: "Full" } },
        }),
    });
    await updates.click();
    await expect(updates).toHaveAttribute("aria-checked", "true");
    await updates.click();
    await expect(updates).toHaveAttribute("aria-checked", "false");
    await updates.click();
    await expect(updates).toHaveAttribute("aria-checked", "true");
    release();
    await expect(updates).toHaveAttribute("aria-busy", "false");
    await expect(updates).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#notifyNote")).toHaveText(
      "Too many devices get notifications already",
    );
  });

  test("fast completion never shows a spinner and timing saves have no category feedback", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    await holdClock(page);
    const toggle = page.locator("#remindersSwitch");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-busy", "false");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.clock.runFor(1000);
    await expect(page.locator(".notification-spinner:visible")).toHaveCount(0);
    const release = await holdRequests(page, PREFERENCES);
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
    await expect(toggle).toHaveAttribute("aria-busy", "false");
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

  test("timing saves, slow, quick, repeated, or failed, keep every control's look and both switches", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    const reminders = page.locator("#remindersSwitch");
    const timing = page.locator("#reminderTiming");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-busy", "false");
    await page.evaluate(watchControlLooks);
    const releaseSlow = await holdRequests(page, PREFERENCES);
    await timing.selectOption("180");
    await expect(reminders).toBeEnabled();
    await timing.selectOption("30");
    await timing.selectOption("60");
    releaseSlow();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("device-notifications")).minutes === 60,
    );
    await expect(reminders).toBeEnabled();
    await page.unroute(PREFERENCES);
    await timing.selectOption("0");
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("device-notifications")).minutes === 0,
    );
    await expect(reminders).toBeEnabled();
    const releaseFailure = await holdRequests(page, PREFERENCES, { answer: failSave });
    await timing.selectOption("10");
    await expect(reminders).toBeEnabled();
    releaseFailure();
    await expect(page.locator("#reminderTimingNote")).toHaveText(/Couldn't update/);
    await expect(page.locator("#notificationsGroup .control-note:not(:empty)")).toHaveCount(1);
    await expect(reminders).toBeEnabled();
    await expect(timing).toHaveValue("0");
    await page.unroute(PREFERENCES);
    await expectSteadyLooks(page, expect, { reminders: "true", updates: "false" });
  });

  for (const category of /** @type {const} */ (["reminders", "updates"]))
    test(`${category} saves by touch and keyboard, slow or failed, keep the other switch and the timing steady`, async ({
      page,
    }) => {
      await app.openApp(page);
      await app.openSettings(page);
      const toggle = page.locator(category === "reminders" ? "#remindersSwitch" : "#notifySwitch");
      const other = page.locator(category === "reminders" ? "#notifySwitch" : "#remindersSwitch");
      const spinner = toggle.locator("..").locator(".notification-spinner");
      await other.click();
      await expect(other).toHaveAttribute("aria-busy", "false");
      await page.evaluate(watchControlLooks);
      await holdClock(page);
      const releaseSlow = await holdRequests(page, PREFERENCES);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(toggle).toBeEnabled();
      await page.clock.runFor(700);
      await expect(spinner).toBeVisible();
      releaseSlow();
      await expect(toggle).toHaveAttribute("aria-busy", "false");
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await page.unroute(PREFERENCES);
      await page.evaluate(() => document.body.classList.add("kbd"));
      const releaseFailure = await holdRequests(page, PREFERENCES, { answer: failSave });
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await page.clock.runFor(700);
      await expect(spinner).toBeVisible();
      releaseFailure();
      await expect(toggle).toHaveAttribute("aria-busy", "false");
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(toggle).toBeFocused();
      await expect(
        page.locator(category === "reminders" ? "#remindersNote" : "#notifyNote"),
      ).toHaveText(/Couldn't update/);
      await expect(page.locator("#notificationsGroup .control-note:not(:empty)")).toHaveCount(1);
      await page.unroute(PREFERENCES);
      await expectSteadyLooks(page, expect, {
        [category === "reminders" ? "updates" : "reminders"]: "true",
      });
    });

  test("blocked notifications fade both switches and the timing", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", { get: () => "denied" });
    });
    await app.openApp(page);
    await app.openSettings(page);
    for (const selector of ["#remindersSwitch", "#notifySwitch", "#reminderTiming"]) {
      await expect(page.locator(selector)).toBeDisabled();
      await expect(page.locator(selector)).toHaveCSS("opacity", "0.5");
    }
    expect(
      await page
        .locator(".reminder-timing")
        .evaluate((row) => getComputedStyle(row, "::after").opacity),
    ).toBe("0.5");
  });

  for (const result of ["denied", "failure"])
    test(`pending retry does not overlap ${result} guidance or move its rows on a phone`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await app.openApp(page);
      await app.openSettings(page);
      await page.locator("#remindersSwitch").click();
      await expect(page.locator("#remindersSwitch")).toHaveAttribute("aria-busy", "false");
      await page.evaluate(holdPermission);
      const toggle = page.locator("#notifySwitch");
      await toggle.click();
      await page.evaluate((result) => Reflect.get(window, "finishPermission")(result), result);
      await expect(toggle).toHaveAttribute("aria-busy", "false");
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
      await expect(toggle).toHaveAttribute("aria-busy", "false");
    });
}
