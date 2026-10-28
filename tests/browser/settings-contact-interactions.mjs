import { holdClock, matchPath } from "./harness.mjs";

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

  test("Settings page rows are one height, with each line between them as far from the text above as below", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#contactBtn")).toBeVisible();
    const rows = await page.locator("#settingsDialog .settings-page-row").evaluateAll((buttons) =>
      buttons.map((button) => {
        const words = document.createRange();
        words.selectNodeContents(
          [...button.childNodes].find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          ),
        );
        const text = words.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        const line = Number.parseFloat(getComputedStyle(button).borderTopWidth);
        return {
          top: box.top,
          bottom: box.bottom,
          line,
          textTop: text.top,
          textBottom: text.bottom,
        };
      }),
    );
    expect(rows).toHaveLength(app === "mlb" ? 2 : 1);
    for (const row of rows) expect(row.bottom - row.top).toBe(rows[0].bottom - rows[0].top);
    for (const [above, below] of rows.slice(1).map((row, index) => [rows[index], row])) {
      expect(below.line).toBe(1);
      expect(below.top).toBe(above.bottom);
      const spaceAbove = below.top - above.textBottom;
      const spaceBelow = below.textTop - (below.top + below.line);
      expect(Math.abs(spaceAbove - spaceBelow)).toBeLessThanOrEqual(1);
    }
  });

  test("search opens each page of settings itself, with no click on its row", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.evaluate(() => {
      document.body.dataset.rowClicks = "0";
      document.addEventListener(
        "click",
        (event) => {
          if (/** @type {Element} */ (event.target).closest?.("#contactBtn, #rankingBtn"))
            document.body.dataset.rowClicks = String(Number(document.body.dataset.rowClicks) + 1);
        },
        { capture: true },
      );
    });
    const search = page.locator("#gameSearch .search-input");
    for (const name of app === "mlb" ? ["Ranking", "Contact"] : ["Contact"]) {
      await page.locator("#tab-search").tap();
      await search.fill(name.toLowerCase());
      await search.press("Enter");
      await page
        .locator("#gameSearch .search-suggestion")
        .filter({ hasText: `Settings${name}` })
        .tap();
      const title = page.locator(`#${name.toLowerCase()}Dialog h2`);
      await expect(title).toBeFocused();
      await expect(title).toBeInViewport();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(page.locator("#settingsDialog")).toBeHidden();
    }
    await expect(page.locator("body")).toHaveAttribute("data-row-clicks", "0");
  });

  test("a label, its note, and its field keep the shared gaps, in Contact and in Settings", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("#contactBtn").click();
    const dialog = page.locator("#contactDialog");
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await expect(dialog.locator("#contactEmail")).toBeVisible();
    const measureGaps = () =>
      page.evaluate(() => {
        const findGap = (/** @type {Element} */ above, /** @type {Element} */ below) =>
          below.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
        const find = (/** @type {string} */ selector) =>
          /** @type {Element} */ (document.querySelector(selector));
        const settingNote = find("#settingsDialog .control-label .control-note");
        return {
          labelToNote: findGap(find("label[for=contactEmail]"), find("#contactEmailHint")),
          noteToField: findGap(find("#contactEmailHint"), find("#contactEmail")),
          labelToField: findGap(find("label[for=contactMessage]"), find("#contactMessage")),
          settingLabelToNote: findGap(
            /** @type {Element} */ (settingNote.previousElementSibling),
            settingNote,
          ),
        };
      });
    expect(await measureGaps()).toEqual({
      labelToNote: 3,
      noteToField: 7,
      labelToField: 7,
      settingLabelToNote: 3,
    });
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--label-note-gap", "5px");
      document.documentElement.style.setProperty("--label-field-gap", "11px");
    });
    expect(await measureGaps()).toEqual({
      labelToNote: 5,
      noteToField: 11,
      labelToField: 11,
      settingLabelToNote: 5,
    });
  });

  test("Contact gives focus back to its row once its sheet has closed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const opener = page.locator("#contactBtn");
    const dialog = page.locator("#contactDialog");
    for (const close of [
      () => dialog.getByRole("button", { name: "Back to Settings" }).click(),
      () => page.keyboard.press("Escape"),
    ]) {
      await page.locator("#settingsDialog .sheet-close").focus();
      await opener.dispatchEvent("click");
      await expect(dialog.locator("h2")).toBeFocused();
      await holdClock(page);
      await close();
      await page.clock.runFor(1000);
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
      await page.clock.resume();
    }
  });

  test("the whole Add screenshot label opens the picker and cancel keeps the Contact draft open", async ({
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
    const attach = dialog.locator('label[for="contactScreenshot"]');
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

  test("Add screenshot's field stays reachable by Tab and VoiceOver, ringing its label", async ({
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
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await page.evaluate(() => document.body.classList.add("kbd"));
    const field = dialog.getByLabel("Add screenshot", { exact: true });
    const label = dialog.locator('label[for="contactScreenshot"]');

    await expect(field).toHaveAttribute("type", "file");
    await expect(field).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
    await expect(field).not.toHaveCSS("display", "none");
    await expect(label).toHaveCSS("outline-style", "none");
    await dialog.locator("textarea").focus();
    await page.keyboard.press("Tab");

    await expect(field).toBeFocused();
    await expect(label).toHaveCSS("outline-style", "solid");
    await expect(label).toHaveCSS("outline-width", "2px");
  });
}
