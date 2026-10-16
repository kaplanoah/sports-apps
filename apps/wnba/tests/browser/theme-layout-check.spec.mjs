import { test, expect } from "@playwright/test";
import { listLayoutChanges, readLayout } from "../../../../tests/browser/theme-layout.mjs";

test("the layout check reads a pressed row only once it lets go", async ({ page }) => {
  await page.setContent(`<button type="button" class="game-open is-pressed">Liberty</button>`);

  const pressed = readLayout(page);
  await page.locator("button").evaluate((button) => button.classList.remove("is-pressed"));
  const first = await pressed;

  expect(listLayoutChanges(first, await readLayout(page))).toEqual([]);
});

test("the layout check still names an element that moves", async ({ page }) => {
  await page.setContent(`<p style="margin: 0; width: 100px; height: 20px">Liberty</p>`);
  const first = await readLayout(page);
  await page.locator("p").evaluate((text) => (text.style.marginLeft = "10px"));

  expect(listLayoutChanges(first, await readLayout(page))).toEqual([
    "p. 0: 8 8 100 20 -> 18 8 100 20",
  ]);
});
