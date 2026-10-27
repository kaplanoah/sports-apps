import { PUSH_STUB, stubPushManager, stubPushRegistration } from "./push-stub.mjs";
import { IPHONE } from "./devices.mjs";
import { openFromHomeScreen } from "./touch.mjs";
import { waitForLoadToSettle } from "./at-rest.mjs";

/** @param {any} test @param {any} expect @param {{openApp: Function, openSettings: Function, isMlb: boolean}} app */
export function testNotificationAlignment(test, expect, app) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  for (const [screen, viewport] of Object.entries({
    phone: { width: 402, height: 874 },
    desktop: { width: 1280, height: 900 },
  })) {
    test.describe(screen, () => {
      test.use({ ...(screen === "phone" ? IPHONE : {}), viewport });
      for (const theme of /** @type {const} */ (["light", "dark"]))
        for (const saved of ["fresh", "previous-release"]) {
          test(`${saved} notification controls share the News right edge in ${theme}`, async ({
            page,
          }) => {
            test.slow();
            await page.emulateMedia({ colorScheme: theme });
            await openFromHomeScreen(page);
            await page.addInitScript(stubPushManager, PUSH_STUB);
            await page.addInitScript(stubPushRegistration);
            if (saved === "previous-release")
              await page.addInitScript(() => {
                if (localStorage.getItem("lastDrawn")) return;
                localStorage.setItem(
                  "lastDrawn",
                  JSON.stringify({
                    notifyRow: {
                      markup: "<span>Notifications</span>",
                      hidden: false,
                      classes: "control-row",
                      savedAt: Date.now(),
                    },
                  }),
                );
              });
            // Keep the wide bracket's paint cost out of this Settings geometry check.
            if (screen === "desktop")
              await page.addInitScript(() => localStorage.setItem("lastTab", "news"));
            await app.openApp(page);
            await app.openSettings(page);
            const reminders = page.locator("#remindersSwitch");
            await expect(reminders).toHaveAttribute("aria-checked", "false");
            for (const state of ["off", "on", "off-again", "reload"]) {
              if (state === "reload") {
                await page.reload({ waitUntil: "domcontentloaded" });
                await waitForLoadToSettle(page);
                await expect(page.locator("#settingsDialog")).toBeVisible();
              } else if (state === "on" || state === "off-again") await reminders.click();
              await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
              await expect(reminders).toHaveAttribute("aria-checked", String(state === "on"));
              await expect(reminders).toBeEnabled();
              const alignment = await page
                .getByRole("group", { name: "Notifications", exact: true })
                .evaluate((group) => {
                  const readRight = (element) => element.getBoundingClientRect().right;
                  const news = document.getElementById("teamOutletsSwitch");
                  return {
                    group: readRight(group),
                    newsGroup: readRight(news.closest(".settings-group")),
                    heading:
                      group.querySelector("h3").getBoundingClientRect().left -
                      document.getElementById("newsSettingsTitle").getBoundingClientRect().left,
                    labels: ["remindersTitle", "notifyTitle"].map(
                      (id) =>
                        document.getElementById(id).getBoundingClientRect().left -
                        document.getElementById("newsSettingsTitle").getBoundingClientRect().left,
                    ),
                    controls: ["remindersSwitch", "reminderTiming", "notifySwitch"].map(
                      (id) => readRight(document.getElementById(id)) - readRight(news),
                    ),
                  };
                });
              const field = await page.locator("#reminderTiming").evaluate(async (select) => {
                const style = getComputedStyle(select);
                await document.fonts.load(style.font, select.options[0].text);
                const probe = document.createElement("span");
                probe.style.position = "absolute";
                probe.style.width = "max-content";
                probe.style.font = style.font;
                probe.style.letterSpacing = style.letterSpacing;
                probe.style.textRendering = style.textRendering;
                probe.style.whiteSpace = "pre";
                probe.textContent = select.options[0].text;
                document.body.append(probe);
                const textWidth = probe.getBoundingClientRect().width;
                probe.remove();
                const row = select.closest(".reminder-timing");
                const caret = getComputedStyle(row, "::after");
                return {
                  width: select.getBoundingClientRect().width,
                  height: select.getBoundingClientRect().height,
                  top: parseFloat(style.paddingTop),
                  bottom: parseFloat(style.paddingBottom),
                  left: parseFloat(style.paddingLeft),
                  right: parseFloat(style.paddingRight),
                  caretRight: parseFloat(caret.right),
                  caretWidth: parseFloat(caret.width),
                  gap:
                    select.clientWidth -
                    parseFloat(style.paddingLeft) -
                    textWidth -
                    parseFloat(caret.width) -
                    (parseFloat(caret.right) - 1),
                  available:
                    select.clientWidth -
                    parseFloat(style.paddingLeft) -
                    parseFloat(style.paddingRight),
                  textWidth,
                };
              });
              expect(field).toMatchObject(
                app.isMlb
                  ? {
                      width: 173,
                      height: 40,
                      top: 6.5,
                      bottom: 7.5,
                      left: 8,
                      right: 25.5,
                      caretRight: 6.5,
                      caretWidth: 16,
                    }
                  : {
                      width: 145,
                      height: 40,
                      top: 7,
                      bottom: 7,
                      left: 8,
                      right: 20,
                      caretRight: 3,
                      caretWidth: 16,
                    },
              );
              expect(field.textWidth).toBeLessThanOrEqual(field.available);
              if (app.isMlb) expect(field.gap).toBeGreaterThanOrEqual(4);
              expect(alignment.group).toBeCloseTo(alignment.newsGroup, 2);
              expect(alignment.heading).toBeCloseTo(0, 2);
              for (const offset of alignment.labels) expect(offset).toBeCloseTo(0, 2);
              for (const offset of alignment.controls) expect(offset).toBeCloseTo(0, 2);
            }
          });
        }
    });
  }
}
