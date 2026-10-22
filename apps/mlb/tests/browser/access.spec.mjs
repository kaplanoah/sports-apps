import { test, expect, openLockedApp, readColor } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { listChipsOffCenter } from "../../../../tests/browser/chip-centering.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { findSeasonTab } from "../../../../tests/browser/season-tab.mjs";
import { readCapitals } from "../../../../tests/browser/capitals.mjs";

/** @param {import("@playwright/test").Page} page */
const findCodeField = (page) => page.getByRole("textbox", { name: "Access code" });

/** @param {import("@playwright/test").Page} page */
const findGate = (page) => page.getByRole("heading", { name: "Enter your access code" });

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} code
 */
async function sendCode(page, code) {
  await findCodeField(page).fill(code);
  await page.getByRole("button", { name: "Open" }).click();
}

test("the gate's text keeps to its type roles", async ({ page }) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await expect(findGate(page)).toBeVisible();
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listChipsOffCenter(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("the gate's heading is set as a sheet's title, Open as the app's other buttons, and the code field inside an outlined button's line", async ({
  page,
}) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  const heading = await readRole(page, "heading");
  const body = await readRole(page, "body");
  await expect(findGate(page)).toHaveCSS("font-size", `${heading.size}px`);
  await expect(findGate(page)).toHaveCSS("font-weight", String(heading.weight));
  await expect(findGate(page)).toHaveCSS("text-transform", "uppercase");

  const open = page.getByRole("button", { name: "Open" });
  await expect(open).toHaveCSS("font-size", `${body.size}px`);
  await expect(open).toHaveCSS("font-weight", String(body.weight));
  await expect(open).toHaveCSS("text-transform", "uppercase");
  await expect(open).toHaveCSS("height", "36px");
  const box = /** @type {{ y: number, height: number }} */ (await open.boundingBox());
  expect((await readCapitals(open)).middle - (box.y + box.height / 2)).toBeCloseTo(0, 0);

  const field = findCodeField(page);
  await expect(field).toHaveCSS("background-color", await readColor(page, "--card"));
  await expect(field).toHaveCSS(
    "box-shadow",
    `${await readColor(page, "--card-border")} 0px 0px 0px 1px inset`,
  );
});

test("the page asks for its code in the theme's accent, and the right one opens the app for good", async ({
  page,
}) => {
  await openLockedApp(page, { accessCode: "FASTBALL" });
  await expect(findGate(page)).toBeVisible();
  await expect(findSeasonTab(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open" })).toHaveCSS(
    "background-color",
    await readColor(page, "--accent"),
  );

  await sendCode(page, "curveball");
  await expect(page.getByRole("alert")).toHaveText(
    "That code isn't right. Check it and try again.",
  );
  await expect(page.getByRole("alert")).toHaveCSS("color", await readColor(page, "--now"));

  await sendCode(page, "fast ball");
  await expect(findSeasonTab(page)).toBeVisible();

  await page.reload();
  await expect(findSeasonTab(page)).toBeVisible();
  await expect(findGate(page)).toHaveCount(0);
});

/**
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} theme
 */
async function expectGateIcons(page, theme) {
  const isDark = theme === "dark";
  await expect(page.locator(".gate-icon:visible")).toHaveAttribute(
    "src",
    isDark ? "icon-180.png" : "icon-light-180.png",
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    isDark ? "icon.svg" : "icon-light.svg",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    isDark ? "icon-180.png" : "icon-light-180.png",
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    isDark ? "#0d1f16" : "#f5f1e6",
  );
}

test("the gate's icon, tab icon, and bar follow the phone's theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openLockedApp(page, { accessCode: "FASTBALL" });
  await expectGateIcons(page, "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expectGateIcons(page, "dark");
});

test("the gate's icons and bar follow the theme picked in settings", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("appearance", JSON.stringify("light")));
  await openLockedApp(page, { accessCode: "FASTBALL" });
  await expectGateIcons(page, "light");
});

test("the gate's text stands out from what's behind it as WCAG's AA level asks, in Ball and Night Game", async ({
  page,
}) => {
  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme: theme });
    await openLockedApp(page, { accessCode: "FASTBALL" });
    await expect(findGate(page)).toBeVisible();
    await sendCode(page, "curveball");
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await listLowContrastText(page), theme).toEqual([]);
  }
});
