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
        await page.clock.install({ time: 0 });
        await page.clock.pauseAt(1000);
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
          const box = element.getBoundingClientRect();
          const toggle = element.nextElementSibling.getBoundingClientRect();
          const root = getComputedStyle(document.documentElement);
          return {
            width: box.width,
            height: box.height,
            gap: toggle.left - box.right,
            top: box.top - toggle.top,
            ring: style.borderTopWidth,
            color: style.borderTopColor,
            track: style.borderRightColor,
            ink: root.getPropertyValue("--ink-dim").trim(),
            divider: root.getPropertyValue("--divider").trim(),
            animation: style.animationName,
          };
        });
        expect(shape).toMatchObject({
          width: 14,
          height: 14,
          gap: 8,
          top: 7,
          ring: "2px",
          animation: "none",
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
        await expect(spinner).toHaveCSS("animation-name", "notification-spin");
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

  test("fast completion never shows a spinner and timing saves have no category feedback", async ({
    page,
  }) => {
    await app.openApp(page);
    await app.openSettings(page);
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
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
      await expect(page.locator("#reminderTiming")).toBeDisabled();
      await page.clock.runFor(1000);
      await expect(page.locator(".notification-spinner:visible")).toHaveCount(0);
      await expect(toggle).toHaveAttribute("aria-busy", "false");
    } finally {
      release();
    }
    await expect(page.locator("#reminderTiming")).toBeEnabled();
    await expect(page.locator("#reminderTiming")).toHaveValue("180");
  });
}
