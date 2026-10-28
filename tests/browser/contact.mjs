import { mkdir } from "node:fs/promises";
import { matchPath } from "./harness.mjs";
import { readContactRequest } from "../../shared/worker/contact-request.js";
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
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
    "base64",
  ),
};

/** @param {import("@playwright/test").Page} page */
async function serveContact(page) {
  const requests = [];
  const delivery = { mode: "success", finish: () => {} };
  await page.route(matchPath("/contact"), async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { email: "owner@example.com" } });
    const body = route.request().postDataJSON();
    await readContactRequest(
      new Request("https://example.com/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    requests.push(body);
    if (delivery.mode === "hold")
      await new Promise((resolve) => {
        delivery.finish = () => resolve(null);
      });
    if (delivery.mode === "failure") return route.abort("failed");
    return route.fulfill({ status: 202, json: { accepted: true, id: body.id } });
  });
  return { requests, delivery };
}

/** @param {import("@playwright/test").Page} page */
async function openContact(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#contactBtn").click();
}

/** @param {import("@playwright/test").Page} page @param {string} app */
async function readContactMenuLayout(page, app) {
  return page.locator("#contactDialog .contact-menu").evaluate((menu, league) => {
    const menuStyle = getComputedStyle(menu);
    const menuBox = menu.getBoundingClientRect();
    const settingsStyle = getComputedStyle(document.getElementById("contactBtn"));
    const probe = document.createElement("span");
    probe.style.color = league === "mlb" ? "var(--bg)" : "var(--raised)";
    document.body.append(probe);
    const surface = getComputedStyle(probe).color;
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
  }, app);
}

/** @param {any} options */
export function registerContactTests({ test, expect, openApp, app }) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("Contact keeps a separate draft and optional screenshot for each category through Back", async ({
    page,
  }) => {
    await serveContact(page);
    await openApp(page);
    await openContact(page);
    const dialog = page.locator("#contactDialog");
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
    await openContact(page);
    const dialog = page.locator("#contactDialog");
    await dialog.getByRole("button", { name: "Bug report", exact: true }).click();
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    await dialog.getByRole("button", { name: "View diagnostics" }).click();
    const report = await dialog.locator("pre").textContent();
    expect(report).toContain(app.toUpperCase());
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
    await openContact(page);
    const dialog = page.locator("#contactDialog");
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
    await openContact(page);
    const dialog = page.locator("#contactDialog");
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

  test("keyboard validation focuses the message and optional email; invalid attachments are rejected", async ({
    page,
  }) => {
    await serveContact(page);
    await openApp(page);
    await openContact(page);
    const dialog = page.locator("#contactDialog");
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
    await openContact(page);
    const dialog = page.locator("#contactDialog");
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
    await expect(dialog.getByAltText("Attached screenshot")).toBeVisible();
    release();
  });

  for (const width of [390, 1280])
    for (const theme of /** @type {const} */ (["light", "dark"]))
      test(`Contact fits ${width}px in ${theme}, with accessible controls and selected typography`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        const { delivery, requests } = await serveContact(page);
        await openApp(page);
        await showTheme(page, theme);
        const folder = process.env.CONTACT_PREVIEW_DIR;
        if (folder) await mkdir(folder, { recursive: true });
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        if (folder)
          await page
            .locator("#settingsDialog")
            .screenshot({ path: `${folder}/${app}-${width}-${theme}-settings.png` });
        await expect(page.locator("#contactBtn")).toHaveCSS("border-top-style", "solid");
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
          if (folder)
            await dialog.screenshot({ path: `${folder}/${app}-${width}-${theme}-${name}.png` });
        };
        await checkView("menu");
        const menu = await readContactMenuLayout(page, app);
        expect(menu.background).toBe("rgba(0, 0, 0, 0)");
        expect(menu.border).toBe("0px");
        expect(menu.rows).toHaveLength(3);
        for (const [index, row] of menu.rows.entries()) {
          expect(row.height).toBe(56);
          expect(row.width).toBe(row.menuWidth);
          expect(row.gap).toBe(index ? 12 : null);
          expect(row.padding).toBe("12px 14px");
          expect(row.border).toBe("1px");
          expect(row.borderColor).toBe("rgba(0, 0, 0, 0)");
          expect(row.radius).toBe("2px");
          expect(row.background).toBe(row.surface);
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
          await expect(dialog.locator("label[for=contactEmail]")).toHaveCSS("margin-bottom", "3px");
          await expect(dialog.locator("#contactEmailHint")).toHaveCSS("margin-bottom", "8px");
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
