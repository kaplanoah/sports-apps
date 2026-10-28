import { expect } from "@playwright/test";

export const SETTINGS = "#settingsDialog";

/**
 * Opens settings from its button, which every app's page has.
 * @param {import("@playwright/test").Page} page
 */
export const openSettings = (page) =>
  page.getByRole("button", { name: "Settings", exact: true }).click();

/** A themed caret leaves its whole tap area to the native select. @param {import("@playwright/test").Locator} picker */
export async function checkSelectArrow(picker) {
  await picker.scrollIntoViewIfNeeded();
  const arrow = await picker.evaluate((field) => {
    const row = field.parentElement;
    if (!row) throw new Error("The select has no row");
    const style = getComputedStyle(row, "::after");
    const probe = document.createElement("span");
    probe.style.color = "var(--ink-dim)";
    document.body.append(probe);
    const dimInk = getComputedStyle(probe).color;
    probe.remove();
    const bounds = field.getBoundingClientRect();
    return {
      mask: style.maskImage,
      color: style.backgroundColor,
      dimInk,
      opacity: Number(style.opacity),
      fieldOpacity: Number(getComputedStyle(field).opacity),
      hitsPicker:
        document.elementFromPoint(bounds.right - 8, bounds.top + bounds.height / 2) === field,
    };
  });
  expect(arrow.mask).toContain("data:image/svg+xml");
  expect(arrow.color).toBe(arrow.dimInk);
  expect(arrow.opacity).toBe(arrow.fieldOpacity);
  expect(arrow.hitsPicker).toBe(true);
}
