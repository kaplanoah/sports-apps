import { holdClock } from "./harness.mjs";
import { openContact, serveContact } from "./contact-views.mjs";

/**
 * Measures each Settings page row, its words, and its caret, and how far the rows lift their words
 * over their middles.
 * @param {import("@playwright/test").Page} page
 */
async function measurePageRows(page) {
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
      const caret = button.querySelector("svg").getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        line: Number.parseFloat(getComputedStyle(button).borderTopWidth),
        textTop: text.top,
        textBottom: text.bottom,
        caretMiddle: (caret.top + caret.bottom) / 2,
      };
    }),
  );
  const lift = await page.evaluate(
    () =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--lowercase-lift"),
      ) / 2,
  );
  return { rows, lift };
}

/**
 * Reads the bottom of each line drawn in settings, from any border.
 * @param {import("@playwright/test").Page} page
 */
function readLineBottoms(page) {
  return page.locator("#settingsDialog").evaluate((settings) =>
    [...settings.querySelectorAll("*")].flatMap((part) => {
      const style = getComputedStyle(part);
      const box = part.getBoundingClientRect();
      if (!box.width) return [];
      const bottoms = [];
      if (style.borderTopStyle !== "none" && Number.parseFloat(style.borderTopWidth))
        bottoms.push(box.top + Number.parseFloat(style.borderTopWidth));
      if (style.borderBottomStyle !== "none" && Number.parseFloat(style.borderBottomWidth))
        bottoms.push(box.bottom);
      return bottoms;
    }),
  );
}

/**
 * Finds, for each shown part of settings the selector matches, the bottom of the nearest line above
 * its top.
 * @param {import("@playwright/test").Page} page
 * @param {string} selector
 */
async function findLinesAbove(page, selector) {
  const lineBottoms = await readLineBottoms(page);
  const parts = await page
    .locator(`#settingsDialog ${selector}`)
    .evaluateAll((shown) =>
      shown
        .filter((part) => part.getClientRects().length)
        .map((part) => ({ name: part.textContent.trim(), top: part.getBoundingClientRect().top })),
    );
  return parts.map(({ name, top }) => ({
    name,
    top,
    lineAbove: Math.max(...lineBottoms.filter((bottom) => bottom <= top + 0.5)),
  }));
}

/**
 * Finds, for each shown group of settings, whether a line sits between its end and the top of what
 * comes next.
 * @param {import("@playwright/test").Page} page
 */
async function findLinesAfterGroups(page) {
  const lineBottoms = await readLineBottoms(page);
  const groups = await page.locator("#settingsDialog").evaluate((settings) => {
    const shown = [...settings.querySelectorAll("*")].filter(
      (part) => part.getClientRects().length,
    );
    return shown
      .filter((part) => part.matches(".settings-group"))
      .map((group) => {
        const next = shown.find(
          (part) =>
            !group.contains(part) &&
            group.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
        return {
          name: group.querySelector(".settings-group-label")?.textContent.trim(),
          bottom: group.getBoundingClientRect().bottom,
          nextTop: next?.getBoundingClientRect().top ?? Number.NaN,
        };
      });
  });
  return groups.map(({ name, bottom, nextTop }) => ({
    name,
    isLineAfter: lineBottoms.some((line) => line >= bottom - 0.5 && line <= nextTop + 1.5),
  }));
}

/**
 * @param {any} test
 * @param {any} expect
 * @param {{ openApp: (page: import("@playwright/test").Page) => Promise<unknown>, settingsPages: string[] }} options
 */
export function testSettingsContactInteractions(test, expect, { openApp, settingsPages }) {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Settings page headings follow pointer and keyboard focus without native outlines", async ({
    page,
  }) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const name of settingsPages) {
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
      await expect(opener).toBeFocused();
    }
  });

  test("a tap on a Settings page row opens its page at once, with no wait for the row's press", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await holdClock(page);
    for (const name of settingsPages) {
      const opener = page.locator(`#${name.toLowerCase()}Btn`);
      const dialog = page.locator(`#${name.toLowerCase()}Dialog`);
      await opener.tap();
      await expect(opener).toHaveClass(/\bis-pressed\b/);
      await expect.poll(() => dialog.evaluate((sheet) => sheet.open)).toBe(true);
      await page.keyboard.press("Escape");
      await page.clock.runFor(1000);
      await expect(dialog).toBeHidden();
    }
  });

  test("Settings page rows are one height, with each line between them as far from the text above as below, and the line above the first as far from its text as those lines are", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#contactBtn")).toBeVisible();
    const { rows, lift } = await measurePageRows(page);
    expect(rows).toHaveLength(settingsPages.length);
    for (const row of rows) expect(row.bottom - row.top).toBe(rows[0].bottom - rows[0].top);
    for (const [above, below] of rows.slice(1).map((row, index) => [rows[index], row])) {
      expect(below.line).toBe(1);
      expect(below.top).toBe(above.bottom);
      const spaceAbove = below.top - (above.textBottom + lift);
      const spaceBelow = below.textTop + lift - (below.top + below.line);
      expect(Math.abs(spaceAbove - spaceBelow)).toBeLessThanOrEqual(1);
    }
    const [{ lineAbove }] = await findLinesAbove(page, ".settings-page-row");
    const [first] = rows;
    const spaceUnderLine = first.textTop - lineAbove;
    const spaceUnderLineBetween = first.textTop - (first.top + first.line);
    expect(Math.abs(spaceUnderLine - spaceUnderLineBetween)).toBeLessThanOrEqual(1);
  });

  test("a Settings page row lifts its words as search lifts its examples, its caret beside them", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#contactBtn")).toBeVisible();
    const { rows, lift } = await measurePageRows(page);
    expect(lift).toBeGreaterThan(0);
    for (const row of rows) {
      const rowMiddle = (row.top + row.line + row.bottom) / 2;
      const wordsMiddle = (row.textTop + row.textBottom) / 2;
      expect(rowMiddle - wordsMiddle).toBeCloseTo(lift, 1);
      expect(Math.abs(row.caretMiddle - wordsMiddle)).toBeLessThanOrEqual(0.5);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("#settingsDialog")).toBeHidden();
    await page.locator("#tab-search").tap();
    const examplePadding = await page
      .locator(".search-example")
      .first()
      .evaluate((example) => {
        const style = getComputedStyle(example);
        return Number.parseFloat(style.paddingBottom) - Number.parseFloat(style.paddingTop);
      });
    expect(examplePadding / 2).toBe(lift);
  });

  test("every group in Settings sits a section's gap below the line above it, a line after it", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#notificationsGroup")).toBeVisible();
    const sectionGap = await page
      .locator("#settingsDialog")
      .evaluate((settings) =>
        Number.parseFloat(getComputedStyle(settings).getPropertyValue("--section-gap")),
      );
    const headings = await findLinesAbove(page, ".settings-group-label");
    expect(headings.map(({ name }) => name)).toEqual(["Notifications", "News"]);
    for (const { name, top, lineAbove } of headings)
      expect({ name, spaceUnderLine: top - lineAbove }).toEqual({
        name,
        spaceUnderLine: sectionGap,
      });
    expect(await findLinesAfterGroups(page)).toEqual([
      { name: "Notifications", isLineAfter: true },
      { name: "News", isLineAfter: true },
    ]);
  });

  test("search opens each page of settings itself, with no click on its row", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    const rowSelector = settingsPages.map((name) => `#${name.toLowerCase()}Btn`).join(", ");
    await page.evaluate((selector) => {
      document.body.dataset.rowClicks = "0";
      document.addEventListener(
        "click",
        (event) => {
          if (/** @type {Element} */ (event.target).closest?.(selector))
            document.body.dataset.rowClicks = String(Number(document.body.dataset.rowClicks) + 1);
        },
        { capture: true },
      );
    }, rowSelector);
    const search = page.locator("#gameSearch .search-input");
    for (const name of settingsPages) {
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
    const dialog = await openContact(page, "Bug report");
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
    await holdClock(page);
    for (const close of [
      () => dialog.getByRole("button", { name: "Back to Settings" }).click(),
      () => page.keyboard.press("Escape"),
    ]) {
      await page.locator("#settingsDialog .sheet-close").focus();
      await opener.dispatchEvent("click");
      await page.clock.runFor(1000);
      await expect(dialog.locator("h2")).toBeFocused();
      await close();
      await page.clock.runFor(1000);
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
    }
  });

  test("the whole Add screenshot label opens the picker and cancel keeps the Contact draft open", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await serveContact(page);
    await openApp(page);
    const dialog = await openContact(page);
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
    await serveContact(page);
    await openApp(page);
    const dialog = await openContact(page);
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
