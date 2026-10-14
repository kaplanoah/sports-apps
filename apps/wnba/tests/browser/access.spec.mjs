import { test, expect, openLockedApp } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";

/** @param {import("@playwright/test").Page} page */
const findCodeField = (page) => page.getByRole("textbox", { name: "Access code" });

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} code
 */
async function sendCode(page, code) {
  await findCodeField(page).fill(code);
  await page.getByRole("button", { name: "Open" }).click();
}

/**
 * Sends the right code, and waits for the app to draw the season it reads.
 * @param {import("@playwright/test").Page} page
 */
async function signIn(page) {
  await sendCode(page, "FASTBREAK");
  await expect(page.locator("#bracketWrap .series").first()).toBeVisible();
}

/** @param {import("@playwright/test").Page} page */
const findGate = (page) => page.getByRole("heading", { name: "Enter your access code" });

test("the gate's text keeps to the type scale, with its code light only because it's large", async ({
  page,
}) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await expect(findGate(page)).toBeVisible();
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  await expect(page.locator(".code-field")).toHaveCSS("font-size", "24px");
  await expect(page.locator(".code-field")).toHaveCSS("font-weight", "300");
});

test("the page asks for its code, and the right one, however it's typed, opens the app for good", async ({
  page,
}) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await expect(findGate(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Bracket" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("alert")).toHaveText("Type the code first");
  expect(await listStrayPeriods(page)).toEqual([]);

  await sendCode(page, "fastbrake");
  await expect(page.getByRole("alert")).toHaveText(
    "That code isn't right. Check it and try again.",
  );
  await expect(findCodeField(page)).toHaveValue("fastbrake");
  await findCodeField(page).fill("fastbreak");
  await expect(page.getByRole("alert")).toHaveText("");

  await findCodeField(page).fill("fast break");
  await findCodeField(page).press("Enter");
  await expect(page.getByRole("tab", { name: "Bracket" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("tab", { name: "Bracket" })).toBeVisible();
  await expect(findGate(page)).toHaveCount(0);
});

test("a new code signs the phone out, and the gate says the code has changed", async ({ page }) => {
  const app = await openLockedApp(page, { accessCode: "FASTBREAK" });
  await signIn(page);

  await page.goto("about:blank");
  app.changeAccessCode("LAYUP");
  await page.goBack();
  await expect(findGate(page)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "The code has changed. Ask whoever sent you the link for the new one.",
  );
  await sendCode(page, "layup");
  await expect(page.getByRole("tab", { name: "Bracket" })).toBeVisible();
});

test("a page left open when the code changes goes back to the gate on its next read", async ({
  page,
}) => {
  const app = await openLockedApp(page, { accessCode: "FASTBREAK" });
  await signIn(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();

  app.changeAccessCode("LAYUP");
  await page
    .locator("#seasonGames .game-day.is-today")
    .getByRole("button", { name: /^Game details: / })
    .first()
    .click();
  await expect(findGate(page)).toBeVisible();
});

test("too many tries ask the phone to wait, even with the right code", async ({ page }) => {
  const app = await openLockedApp(page, { accessCode: "FASTBREAK" });
  app.limitTries();
  await sendCode(page, "FASTBREAK");
  await expect(page.getByRole("alert")).toHaveText("Too many tries. Try again in a minute.");
  await expect(findGate(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Open" })).toBeEnabled();
});

/**
 * How far the icon sits below the top of the screen, and Open above its bottom.
 * @param {import("@playwright/test").Page} page
 */
async function measureGateMargins(page) {
  const icon = await page.locator(".gate-icon:visible").boundingBox();
  const open = await page.getByRole("button", { name: "Open" }).boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  return {
    above: Math.round(icon?.y ?? 0),
    below: Math.round(height - (open?.y ?? 0) - (open?.height ?? 0)),
  };
}

test("the gate sits in the middle of a short screen, and a message doesn't move it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  const margins = await measureGateMargins(page);
  expect(Math.abs(margins.above - margins.below)).toBeLessThanOrEqual(1);

  await sendCode(page, "fastbrake");
  await expect(page.getByRole("alert")).toHaveText(
    "That code isn't right. Check it and try again.",
  );
  expect(await measureGateMargins(page)).toEqual(margins);
});

test("the code field shows it's ready with its cursor, not an outline", async ({ page }) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await findCodeField(page).focus();
  await expect(findCodeField(page)).toHaveCSS("outline-style", "none");
});

test("the gate's heading, code, and Open each draw in their own weight of Barlow Condensed", async ({
  page,
}) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  const heading = String((await readRole(page, "headline")).weight - 100);
  const open = String((await readRole(page, "body")).weight + 200);
  await expect(findGate(page)).toHaveCSS("font-weight", heading);
  await expect(findCodeField(page)).toHaveCSS("font-weight", "300");
  await expect(page.getByRole("button", { name: "Open" })).toHaveCSS("font-weight", open);

  const loadedWeights = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.family.includes("Barlow Condensed") && face.status === "loaded")
      .map((face) => face.weight);
  });
  expect(loadedWeights).toEqual(expect.arrayContaining([heading, "300", open]));
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
    isDark ? "#1d1511" : "#ead5b2",
  );
}

test("the gate's tab icon and bar follow the phone's theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await expectGateIcons(page, "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expectGateIcons(page, "dark");
});

test("the gate's tab icon and bar follow the theme picked in settings", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("appearance", "light"));
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await expectGateIcons(page, "light");
});
