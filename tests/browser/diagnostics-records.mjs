import { expect } from "@playwright/test";
import { RECORD_MS } from "../../shared/page/diagnostics.js";
import { openSettings } from "./settings.mjs";

// The Diagnostics records in every app's settings.

/** @param {import("@playwright/test").Page} page */
export const findRecords = (page) => page.locator("#diagnostics");

/**
 * Empties a part and fills it again while the page's record is under way, then lets the record
 * finish, so it's flagged as a dip.
 * @param {import("@playwright/test").Page} page
 * @param {string} part the selector of a part the record watches
 */
export async function makeDip(page, part) {
  const markup = await page.locator(part).evaluate((element) => {
    const shown = element.innerHTML;
    element.replaceChildren();
    return shown;
  });
  await page.clock.runFor(300);
  await page.locator(part).evaluate((element, shown) => {
    element.innerHTML = shown;
  }, markup);
  await page.clock.runFor(RECORD_MS);
}

/**
 * Sets how far the visual viewport sits below the layout one's top, without telling the page.
 * @param {import("@playwright/test").Page} page
 * @param {number} top
 */
export async function setVisualViewportTop(page, top) {
  await page.evaluate(
    (offsetTop) =>
      Object.defineProperty(visualViewport, "offsetTop", {
        configurable: true,
        get: () => offsetTop,
      }),
    top,
  );
}

/** Tells the page its visual viewport moved. */
export const scrollVisualViewport = () => visualViewport?.dispatchEvent(new Event("scroll"));

/**
 * Moves the visual viewport out of line with the layout one, so the Viewport record is flagged as
 * off once the page reads it.
 * @param {import("@playwright/test").Page} page
 * @param {() => void} moveViewport what tells the page the viewport moved
 */
export async function moveVisualViewportOff(page, moveViewport = scrollVisualViewport) {
  await setVisualViewportTop(page, 110);
  await page.evaluate(moveViewport);
  await page.clock.runFor(100);
}

/**
 * Makes a dip while the page's record is under way and moves the visual viewport off, then opens
 * settings on a record flagged as a dip and a Viewport record flagged as off, each flag in the
 * theme's accent.
 * @param {import("@playwright/test").Page} page
 * @param {string} part the selector of a part the record watches
 */
export async function showDipAndOffViewport(page, part) {
  await makeDip(page, part);
  await moveVisualViewportOff(page);
  await openSettings(page);

  const records = findRecords(page).locator(".diagnostics-record");
  const dipRecord = records.first();
  const viewportRecord = records.filter({ hasText: "Viewport" });
  await expect(dipRecord.locator("summary")).toContainText("Dip");
  await expect(viewportRecord.locator("summary")).toContainText("Off");

  const accent = await readAccent(page);
  await expect(dipRecord.locator(".diagnostics-flag.dip")).toHaveCSS("color", accent);
  await expect(viewportRecord.locator(".diagnostics-flag.dip")).toHaveCSS("color", accent);
}

/**
 * Reads the theme's `--accent` as the page draws it.
 * @param {import("@playwright/test").Page} page
 */
const readAccent = (page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
