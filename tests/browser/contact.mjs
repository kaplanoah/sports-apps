import { openContact, serveContact } from "./contact-views.mjs";
import { listTextOffRoles } from "./type-roles.mjs";
import { listLowContrastText } from "./contrast.mjs";
import { showTheme } from "./theme-layout.mjs";
import { listTapsOffButtons } from "./tap-states.mjs";
import { holdRequests } from "./hold-requests.mjs";
import { listStrayPeriods } from "./stray-periods.mjs";

const SCREENSHOT = {
  name: "phone.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==",
    "base64",
  ),
};

/** @param {import("@playwright/test").Page} page */
async function readContactMenuLayout(page) {
  return page.locator("#contactDialog .contact-menu").evaluate((menu) => {
    const menuStyle = getComputedStyle(menu);
    const menuBox = menu.getBoundingClientRect();
    const settingsStyle = getComputedStyle(document.getElementById("contactBtn"));
    const probe = document.createElement("span");
    probe.style.color = "var(--contact-menu-surface)";
    probe.style.borderColor = "var(--contact-menu-edge)";
    probe.style.borderRadius = "var(--radius-control)";
    probe.style.padding = "12px 14px calc(12px + var(--lowercase-lift))";
    document.body.append(probe);
    const tokens = getComputedStyle(probe);
    const surface = {
      background: tokens.color,
      edge: tokens.borderColor,
      radius: tokens.borderRadius,
      padding: tokens.padding,
    };
    probe.remove();
    const buttons = [...menu.querySelectorAll("button")];
    return {
      background: menuStyle.backgroundColor,
      border: menuStyle.borderWidth,
      rows: buttons.map((button, index) => {
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        const previous = buttons[index - 1]?.getBoundingClientRect();
        const caret = button.querySelector("svg").getBoundingClientRect();
        return {
          height: box.height,
          width: box.width,
          menuWidth: menuBox.width,
          gap: previous ? box.top - previous.bottom : null,
          padding: style.padding,
          border: style.borderWidth,
          borderColor: style.borderColor,
          radius: style.borderRadius,
          background: style.backgroundColor,
          surface,
          matchesSettingsType:
            style.fontSize === settingsStyle.fontSize &&
            style.fontWeight === settingsStyle.fontWeight &&
            style.fontFamily === settingsStyle.fontFamily,
          caret: [caret.width, caret.height],
        };
      }),
    };
  });
}

/**
 * @param {any} test
 * @param {any} expect
 * @param {{ openApp: (page: import("@playwright/test").Page) => Promise<unknown>, league: string }} options
 */
export function testContact(test, expect, { openApp, league }) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("Contact keeps a separate draft and optional screenshot for each category through Back", async ({
    page,
  }) => {
    await serveContact(page);
    await openApp(page);
    const dialog = await openContact(page);
    await expect(dialog.getByRole("link")).toHaveAttribute("href", "mailto:owner@example.com");
    await expect(dialog.locator(".settings-page-row")).toHaveText([
      "Bug report",
      "Feature request",
      "Something else",
    ]);
    for (const [index, name] of ["Bug report", "Feature request", "Something else"].entries()) {
      await dialog.getByRole("button", { name, exact: true }).click();
      await dialog.locator("textarea").fill(`Draft ${index}`);
      await dialog.getByLabel("Email (optional)").fill(`fan${index}@example.com`);
      await dialog.locator('input[type="file"]').setInputFiles(SCREENSHOT);
      await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
      if (index === 0) await dialog.getByRole("checkbox").uncheck();
      else await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Back to Contact", exact: true }).click();
    }
    for (const [index, name] of ["Bug report", "Feature request", "Something else"].entries()) {
      await dialog.getByRole("button", { name, exact: true }).click();
      await expect(dialog.locator("textarea")).toHaveValue(`Draft ${index}`);
      await expect(dialog.getByLabel("Email (optional)")).toHaveValue(`fan${index}@example.com`);
      await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
      if (index === 0) await expect(dialog.getByRole("checkbox")).not.toBeChecked();
      await dialog.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(dialog.getByAltText("Attached screenshot")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Back to Contact", exact: true }).click();
    }
    await dialog.getByRole("button", { name: "Back to Settings", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#settingsDialog")).toBeVisible();
  });

  test("bug reports preview the exact real diagnostics sent without enabling recording", async ({
    page,
  }) => {
    const { requests } = await serveContact(page);
    await openApp(page);
    const dialog = await openContact(page);
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    await dialog.getByRole("button", { name: "View diagnostics" }).click();
    const report = await dialog.locator("pre").textContent();
    expect(report).toContain(league);
    expect(report).not.toContain("example build");
    expect(report).not.toContain("127.0.0.1");
    expect(await page.evaluate(() => localStorage.getItem("diagnostics"))).toBeNull();
    await dialog.getByRole("button", { name: "Hide diagnostics" }).click();
    await expect(dialog.locator("pre")).toBeHidden();
    await dialog.locator("textarea").fill("The score stopped changing");
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
    expect(requests[0].diagnostics).toBe(report);
    expect(await page.evaluate(() => localStorage.getItem("diagnostics"))).toBeNull();
    await expect(dialog).toContainText(
      "Since you didn't include your email address, we won't be able to reply",
    );
    expect(await listStrayPeriods(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.locator("#contactBtn").click();
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await expect(dialog.locator("textarea")).toHaveValue("");
    await expect(dialog.getByRole("checkbox")).toBeChecked();
  });

  test("an uncertain failure retains all fields, screenshot and diagnostics opt-out; retry uses one identifier", async ({
    page,
  }) => {
    const { requests, delivery } = await serveContact(page);
    delivery.mode = "failure";
    await openApp(page);
    const dialog = await openContact(page);
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await dialog.locator("textarea").fill("The score stopped changing");
    await dialog.getByLabel("Email (optional)").fill("fan@example.com");
    await dialog.locator('input[type="file"]').setInputFiles(SCREENSHOT);
    await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
    await dialog.getByRole("checkbox").uncheck();
    await dialog.getByRole("button", { name: "View diagnostics" }).click();
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Couldn't confirm your message was sent");
    expect(await listStrayPeriods(page)).toEqual([]);
    await expect(dialog.locator("textarea")).toHaveValue("The score stopped changing");
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
    await dialog.getByRole("button", { name: "Back to Contact", exact: true }).click();
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await expect(dialog.getByLabel("Email (optional)")).toHaveValue("fan@example.com");
    delivery.mode = "success";
    await dialog.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]).not.toHaveProperty("diagnostics");
    await expect(dialog).toContainText("Replies will go to fan@example.com");
    expect(await listStrayPeriods(page)).toEqual([]);
  });

  test("sending disables all changes, keeps progress inside Send, and prevents duplicates and Escape", async ({
    page,
  }) => {
    const { requests, delivery } = await serveContact(page);
    delivery.mode = "hold";
    await openApp(page);
    const dialog = await openContact(page);
    await dialog.getByRole("button", { name: "Feature request", exact: true }).click();
    await dialog.locator("textarea").fill("A request");
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Sending\u2026", exact: true })).toBeDisabled();
    await expect(dialog.locator(".contact-spinner")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Back to Contact", exact: true }),
    ).toBeDisabled();
    await dialog
      .locator("form")
      .evaluate((form) => /** @type {HTMLFormElement} */ (form).requestSubmit());
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    delivery.mode = "success";
    delivery.finish();
    await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
    expect(requests[0]).not.toHaveProperty("diagnostics");
  });

  test("a bug report reads the page's diagnostics again each time it opens", async ({ page }) => {
    await serveContact(page);
    await openApp(page);
    const dialog = await openContact(page, "Bug report");
    await dialog.getByRole("button", { name: "View diagnostics" }).click();
    const report = await dialog.locator("pre").textContent();
    await dialog.getByRole("button", { name: "Back to Contact", exact: true }).click();
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: viewport.width - 40, height: viewport.height - 40 });
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();

    await expect(dialog.locator("pre")).not.toHaveText(report);
  });

  const RETRY_ENDINGS = [
    {
      change: "its message changes",
      makeChange: (dialog) =>
        dialog.locator("textarea").fill("The score stopped changing in the ninth"),
    },
    {
      change: "a screenshot is attached",
      makeChange: (dialog) => dialog.locator('input[type="file"]').setInputFiles(SCREENSHOT),
    },
    {
      change: "its screenshot is removed",
      hasScreenshot: true,
      makeChange: (dialog) => dialog.getByRole("button", { name: "Remove", exact: true }).click(),
    },
  ];
  for (const { change, hasScreenshot, makeChange } of RETRY_ENDINGS)
    test(`a bug report keeps a failed send's diagnostics until ${change}, then shows and sends the page's as they are`, async ({
      page,
    }) => {
      const { requests, delivery } = await serveContact(page);
      delivery.mode = "failure";
      await openApp(page);
      const dialog = await openContact(page, "Bug report");
      await dialog.locator("textarea").fill("The score stopped changing");
      if (hasScreenshot) {
        await dialog.locator('input[type="file"]').setInputFiles(SCREENSHOT);
        await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
      }
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        "Couldn't confirm your message was sent",
      );
      await dialog.getByRole("button", { name: "Back to Contact", exact: true }).click();
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: viewport.width - 40, height: viewport.height - 40 });
      await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
      await dialog.getByRole("button", { name: "View diagnostics" }).click();
      await expect(dialog.locator("pre")).toHaveText(requests[0].diagnostics);
      await makeChange(dialog);
      await expect(dialog.locator("pre")).not.toHaveText(requests[0].diagnostics);
      const shown = await dialog.locator("pre").textContent();
      delivery.mode = "success";
      await dialog.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
      expect(requests[1].id).not.toBe(requests[0].id);
      expect(requests[1].diagnostics).toBe(shown);
    });

  test("a send pressed while a screenshot is still read waits for it and the page's diagnostics", async ({
    page,
  }) => {
    const { requests, delivery } = await serveContact(page);
    delivery.mode = "failure";
    await openApp(page);
    const dialog = await openContact(page, "Bug report");
    await dialog.locator("textarea").fill("The score stopped changing");
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Couldn't confirm your message was sent");
    await dialog.getByRole("button", { name: "Back to Contact", exact: true }).click();
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: viewport.width - 40, height: viewport.height - 40 });
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await dialog.getByRole("button", { name: "View diagnostics" }).click();
    await page.evaluate(() => {
      const createBitmap = window.createImageBitmap;
      const held = new Promise((resolve) => {
        /** @type {any} */ (window).releaseScreenshot = resolve;
      });
      /** @type {any} */ (window).createImageBitmap = (/** @type {ImageBitmapSource} */ source) =>
        held.then(() => createBitmap(source));
    });
    await dialog.locator('input[type="file"]').setInputFiles(SCREENSHOT);
    await dialog.getByRole("button", { name: "Try again", exact: true }).click();
    await page.evaluate(() => /** @type {any} */ (window).releaseScreenshot());
    await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);
    await expect(dialog.getByRole("alert")).toBeVisible();

    expect(requests[1].id).not.toBe(requests[0].id);
    expect(requests[1].screenshot.filename).toBe(SCREENSHOT.name);
    expect(requests[1].diagnostics).not.toBe(requests[0].diagnostics);
    await expect(dialog.locator("pre")).toHaveText(requests[1].diagnostics);
  });

  test("trying again takes away the failed send's note while it sends", async ({ page }) => {
    const { requests, delivery } = await serveContact(page);
    delivery.mode = "failure";
    await openApp(page);
    const dialog = await openContact(page, "Something else");
    await dialog.locator("textarea").fill("A message");
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    delivery.mode = "hold";
    await dialog.getByRole("button", { name: "Try again", exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);

    await expect(dialog.getByRole("alert")).toHaveCount(0);
    delivery.mode = "success";
    delivery.finish();
    await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
  });

  test("keyboard validation focuses the message and optional email; invalid attachments are rejected", async ({
    page,
  }) => {
    await serveContact(page);
    await openApp(page);
    const dialog = await openContact(page);
    await dialog.getByRole("button", { name: "Something else", exact: true }).click();
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.locator("textarea")).toBeFocused();
    await expect(dialog.locator("textarea")).toHaveAttribute("aria-invalid", "true");
    await dialog.locator("textarea").fill("A message");
    await dialog.getByLabel("Email (optional)").fill("bad");
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.getByLabel("Email (optional)")).toBeFocused();
    await expect(dialog.getByLabel("Email (optional)")).toHaveAttribute(
      "aria-describedby",
      "contactEmailHint contactValidation",
    );
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "unsafe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
    await expect(dialog.getByRole("alert")).toHaveText("Choose a PNG, JPEG, or WebP screenshot");
    await expect(dialog.getByAltText("Attached screenshot")).toHaveCount(0);
  });

  test("a reload restores the category, draft, screenshot and diagnostic opt-out", async ({
    page,
  }) => {
    await serveContact(page);
    await openApp(page);
    const dialog = await openContact(page);
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await dialog.locator("textarea").fill("Kept after reload");
    await dialog.getByRole("checkbox").uncheck();
    await dialog.locator('input[type="file"]').setInputFiles(SCREENSHOT);
    await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
    const release = await holdRequests(page, /\/js\/app\.js/);
    await page.reload({ waitUntil: "commit" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("textarea")).toHaveValue("Kept after reload");
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    const screenshot = dialog.getByAltText("Attached screenshot");
    await expect(screenshot).toBeVisible();
    await expect
      .poll(() =>
        screenshot.evaluate((image) => /** @type {HTMLImageElement} */ (image).naturalWidth),
      )
      .toBe(132);
    release();
  });

  for (const width of [390, 1280])
    for (const theme of /** @type {const} */ (["light", "dark"]))
      test(`Contact fits ${width}px in ${theme}, with accessible controls and its type roles`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        const { delivery, requests } = await serveContact(page);
        await openApp(page);
        await showTheme(page, theme);
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        expect(
          await page.locator("#contactBtn").evaluate((button) => {
            const lined = button.previousElementSibling ? button : button.parentElement;
            return getComputedStyle(lined).borderTopStyle;
          }),
        ).toBe("solid");
        await page.locator("#contactBtn").click();
        const dialog = page.locator("#contactDialog");
        const checkView = async (name) => {
          await page.clock.runFor(1000);
          expect(await listTextOffRoles(page), name).toEqual([]);
          expect(await listLowContrastText(page), name).toEqual([]);
          expect(await listTapsOffButtons(page), name).toEqual([]);
          expect(
            await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
            name,
          ).toBe(true);
          expect(await dialog.evaluate((element) => element.clientWidth), name).toBeLessThanOrEqual(
            440,
          );
        };
        await checkView("menu");
        const menu = await readContactMenuLayout(page);
        expect(menu.background).toBe("rgba(0, 0, 0, 0)");
        expect(menu.border).toBe("0px");
        expect(menu.rows).toHaveLength(3);
        for (const [index, row] of menu.rows.entries()) {
          expect(row.height).toBe(56);
          expect(row.width).toBe(row.menuWidth);
          expect(row.gap).toBe(index ? 12 : null);
          expect(row.padding).toBe(row.surface.padding);
          expect(row.border).toBe("1px");
          expect(row.borderColor).toBe(row.surface.edge);
          expect(row.radius).toBe(row.surface.radius);
          expect(row.background).toBe(row.surface.background);
          expect(row.matchesSettingsType).toBe(true);
          expect(row.caret).toEqual([18, 18]);
        }
        const address = dialog.locator(".contact-domain");
        await expect(address).toHaveText("Or email directly at owner@example.com");
        await expect(address).toHaveCSS("padding-inline-start", "1px");
        const addressGap = await address.evaluate((element) => {
          const previous = element.previousElementSibling.getBoundingClientRect();
          return element.getBoundingClientRect().top - previous.bottom;
        });
        expect(addressGap).toBe(14);
        for (const name of ["Bug report", "Feature request", "Something else"]) {
          await dialog.getByRole("button", { name, exact: true }).click();
          await checkView(name.replaceAll(" ", "-"));
          if (name === "Bug report") {
            await dialog.getByRole("button", { name: "View diagnostics" }).click();
            await checkView("diagnostics");
          }
          await dialog.getByRole("button", { name: "Back to Contact", exact: true }).click();
        }
        await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
        await dialog.locator("textarea").fill("The score stopped changing");
        delivery.mode = "failure";
        await dialog.getByRole("button", { name: "Send", exact: true }).click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        await checkView("failure");
        delivery.mode = "success";
        await dialog.getByRole("button", { name: "Try again", exact: true }).click();
        await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
        await checkView("received");
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
        await page.locator("#contactBtn").click();
        await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
        await dialog.locator("textarea").fill("The score stopped changing");
        await dialog.getByLabel("Email (optional)").fill("fan@example.com");
        await dialog.locator('input[type="file"]').setInputFiles(SCREENSHOT);
        await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
        await checkView("screenshot");
        delivery.mode = "hold";
        await dialog.getByRole("button", { name: "Send", exact: true }).click();
        await expect.poll(() => requests.length).toBe(3);
        await checkView("sending");
        delivery.mode = "success";
        delivery.finish();
        await expect(dialog.getByRole("heading", { name: "Message sent" })).toBeVisible();
        await checkView("received-email");
      });
}
