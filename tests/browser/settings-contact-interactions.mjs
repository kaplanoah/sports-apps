import { matchPath } from "./harness.mjs";

/** @param {any} options */
export function registerSettingsContactInteractions({ test, expect, openApp, app }) {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Settings page headings follow pointer and keyboard focus without native outlines", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const name of app === "mlb" ? ["Ranking", "Contact"] : ["Contact"]) {
      const opener = page.locator(`#${name.toLowerCase()}Btn`);
      const dialog = page.locator(`#${name.toLowerCase()}Dialog`);
      const title = dialog.locator("h2");
      await opener.tap();
      await expect(title).toBeFocused();
      await expect(title).toHaveCSS("outline-style", "none");
      await dialog.getByRole("button", { name: "Back to Settings" }).click();
      await expect(opener).toBeFocused();
      await page.keyboard.press("Tab");
      await opener.focus();
      await page.keyboard.press("Enter");
      await expect(title).toBeFocused();
      await expect(title).toHaveCSS("outline-style", "solid");
      await expect(title).toHaveCSS("outline-width", "2px");
      if (name === "Contact") {
        await dialog.getByRole("button", { name: "Bug report", exact: true }).tap();
        await expect(title).toBeFocused();
        await expect(title).toHaveCSS("outline-style", "none");
        await dialog.getByRole("button", { name: "Back to Contact" }).click();
      }
      await dialog.getByRole("button", { name: "Back to Settings" }).click();
    }
  });

  test("the whole screenshot button opens the picker and cancel keeps the Contact draft open", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route(matchPath("/contact"), (route) =>
      route.fulfill({ json: { email: "owner@example.com" } }),
    );
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("#contactBtn").click();
    const dialog = page.locator("#contactDialog");
    await dialog.getByRole("button", { name: "Bug report", exact: true }).tap();
    await dialog.locator("textarea").fill("Keep this draft");
    const attach = dialog.getByRole("button", { name: "Add screenshot", exact: true });
    await expect(dialog.locator('input[type="file"]')).toBeHidden();
    const box = await attach.boundingBox();
    for (const position of [
      { x: 3, y: 3 },
      { x: box.width - 3, y: box.height - 3 },
      { x: box.width / 2, y: box.height / 2 },
    ]) {
      const chooser = page.waitForEvent("filechooser");
      await attach.tap({ position });
      await chooser;
      await dialog.locator('input[type="file"]').dispatchEvent("cancel", { bubbles: true });
      await page.clock.runFor(1000);
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("textarea")).toHaveValue("Keep this draft");
      await expect(dialog.getByRole("heading", { name: "Bug report" })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page.clock.runFor(1000);
    await expect(dialog).toBeHidden();
  });
}
