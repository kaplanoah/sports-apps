import { holdClock } from "./harness.mjs";
import { openContact, serveContact } from "./contact-views.mjs";
import {
  PRESSED_FILLED_BACKGROUND,
  PRESSED_OUTLINED_BACKGROUND,
  pressOn,
  readBackground,
  readPressTint,
} from "./press-looks.mjs";

// How the settings pages' controls show their press (press.js and controls.css), and which wait
// for it before they act, in every app.

/** @param {import("@playwright/test").Page} page */
async function openBugReport(page) {
  const dialog = await openContact(page, "Bug report");
  await dialog.locator("textarea").fill("The score stopped changing");
  return dialog;
}

// Lets go of a press on its sheet's title, so nothing is clicked.
/** @param {import("@playwright/test").Page} page @param {import("@playwright/test").Locator} control */
async function liftOnTitle(page, control) {
  const title = control.locator("xpath=ancestor::dialog").locator("h2").first();
  const box = await title.boundingBox();
  if (!box) throw new Error("No title shows to lift on");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.up();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} row
 * @param {import("@playwright/test").Expect<any>} expect
 */
async function expectRowTint(page, row, expect) {
  const pressed = await readBackground(row, "var(--pressed-row)");

  await pressOn(page, row);

  await expect(row).toHaveClass(/is-row-press/);
  expect(await readPressTint(row)).toBe(pressed);
  await expect(row).toHaveCSS("opacity", "1");
  await liftOnTitle(page, row);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} control
 * @param {import("@playwright/test").Expect<any>} expect
 */
async function expectFade(page, control, expect) {
  await pressOn(page, control);

  await expect(control).toHaveClass(/is-pressed/);
  await expect(control).toHaveCSS("opacity", "0.3");
  await liftOnTitle(page, control);
}

/**
 * @param {any} test
 * @param {any} expect
 * @param {{ openApp: (page: import("@playwright/test").Page) => Promise<unknown>, settingsPages: string[] }} options
 */
export function testContactPresses(test, expect, { openApp, settingsPages }) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("a press tints each settings page's row in settings, and Contact's category rows", async ({
    page,
  }) => {
    await serveContact(page);
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const name of settingsPages)
      await expectRowTint(page, page.locator(`#${name.toLowerCase()}Btn`), expect);
    await page.locator("#contactBtn").click();
    const dialog = page.locator("#contactDialog");

    for (const name of ["Bug report", "Feature request", "Something else"])
      await expectRowTint(page, dialog.getByRole("button", { name, exact: true }), expect);
  });

  test("a press darkens Contact's Send and Done with black", async ({ page }) => {
    await serveContact(page);
    await openApp(page);
    const dialog = await openBugReport(page);

    for (const name of ["Send", "Done"]) {
      const button = dialog.getByRole("button", { name, exact: true });
      const pressed = await readBackground(button, PRESSED_FILLED_BACKGROUND);
      await pressOn(page, button);

      await expect(button).toHaveClass(/is-pressed/);
      await expect(button).toHaveCSS("background-color", pressed);
      await expect(button).toHaveCSS("opacity", "1");
      if (name === "Send") {
        await page.mouse.up();
        await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
      }
    }
  });

  test("a press fills Contact's Add screenshot with some ink", async ({ page }) => {
    await serveContact(page);
    await openApp(page);
    const dialog = await openBugReport(page);
    const label = dialog.locator('label[for="contactScreenshot"]');
    const pressed = await readBackground(label, PRESSED_OUTLINED_BACKGROUND);

    await pressOn(page, label);

    await expect(label).toHaveClass(/is-pressed/);
    await expect(label).toHaveCSS("background-color", pressed);
    await expect(label).toHaveCSS("opacity", "1");
  });

  test("a press fades Contact's Back, its diagnostics toggle, and its email link", async ({
    page,
  }) => {
    await serveContact(page);
    await openApp(page);
    const dialog = await openContact(page);
    await expectFade(page, dialog.getByRole("link", { name: "owner@example.com" }), expect);
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();

    await expectFade(page, dialog.getByRole("button", { name: "View diagnostics" }), expect);
    await expectFade(page, dialog.getByRole("button", { name: "Back to Contact" }), expect);
  });

  test("the settings pages' Back, Contact's category rows, and Done show their press before they act", async ({
    page,
  }) => {
    await serveContact(page);
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const title = page.locator("#contactDialog h2");
    await holdClock(page);

    /** @param {import("@playwright/test").Locator} control @param {() => Promise<void>} isUnchanged @param {() => Promise<void>} isDone */
    const expectPressFirst = async (control, isUnchanged, isDone) => {
      await control.click();
      await expect(control).toHaveClass(/is-pressed/);
      await isUnchanged();
      await page.clock.runFor(1000);
      await isDone();
    };

    for (const name of settingsPages) {
      const sheet = page.locator(`#${name.toLowerCase()}Dialog`);
      await page.locator(`#${name.toLowerCase()}Btn`).click();
      await page.clock.runFor(1000);
      await expect(sheet.locator("h2")).toHaveText(name);
      await expectPressFirst(
        sheet.getByRole("button", { name: "Back to Settings" }),
        () => expect(sheet).toBeVisible(),
        () => expect(sheet).toBeHidden(),
      );
    }
    const dialog = page.locator("#contactDialog");
    const sendBugReport = async () => {
      await page.locator("#contactBtn").click();
      await page.clock.runFor(1000);
      await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
      await page.clock.runFor(1000);
      await dialog.locator("textarea").fill("The score stopped changing");
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
    };
    await page.locator("#contactBtn").click();
    await page.clock.runFor(1000);
    await expectPressFirst(
      dialog.getByRole("button", { name: "Bug report", exact: true }),
      () => expect(title).toHaveText("Contact"),
      () => expect(title).toHaveText("Bug report"),
    );
    await expectPressFirst(
      dialog.getByRole("button", { name: "Back to Contact" }),
      () => expect(title).toHaveText("Bug report"),
      () => expect(title).toHaveText("Contact"),
    );
    await page.keyboard.press("Escape");
    await page.clock.runFor(1000);
    await sendBugReport();
    await expectPressFirst(
      dialog.getByRole("button", { name: "Done", exact: true }),
      () => expect(dialog).toBeVisible(),
      () => expect(dialog).toBeHidden(),
    );
    await sendBugReport();
    await expectPressFirst(
      dialog.getByRole("button", { name: "Back to Settings" }),
      () => expect(dialog).toBeVisible(),
      () => expect(dialog).toBeHidden(),
    );
  });
}
