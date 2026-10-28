import { test, expect } from "@playwright/test";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";

// Gray on white at 2.85 to 1, under AA's 4.5.
const LOW_CONTRAST = "#999999";

test("the contrast check measures a pressed row only once it lets go", async ({ page }) => {
  await page.setContent(
    `<style>body { background: #fff; color: #111 } .is-pressed { color: ${LOW_CONTRAST} }</style>
    <button type="button" class="is-pressed">Mets</button>`,
  );

  const measured = listLowContrastText(page);
  await page.locator("button").evaluate((button) => button.classList.remove("is-pressed"));

  expect(await measured).toEqual([]);
});

test("the contrast check measures a color only once its transition ends", async ({ page }) => {
  await page.setContent(
    `<style>
      body { background: #fff }
      p { color: ${LOW_CONTRAST}; transition: color 2s linear }
      p.done { color: #111 }
    </style>
    <p>Rangers</p>`,
  );
  await page.locator("p").evaluate((text) => {
    getComputedStyle(text).color;
    text.classList.add("done");
  });

  expect(await listLowContrastText(page)).toEqual([]);
});

test("the contrast check still names text that is low at rest", async ({ page }) => {
  await page.setContent(
    `<style>body { background: #fff } p { color: ${LOW_CONTRAST} }</style><p>Rangers</p>`,
  );

  expect(await listLowContrastText(page)).toEqual(['p. "Rangers": 2.85 to 1, under 4.5']);
});

test("the contrast check measures a label hung beside a see-through row over what holds it", async ({
  page,
}) => {
  await page.setContent(
    `<style>
      body { background: #fff; padding-left: 100px }
      div { position: relative; background: rgba(0, 0, 0, 0.3) }
      span { position: absolute; right: calc(100% + 10px); color: #666 }
    </style>
    <div><span>Seed</span>Rangers</div>`,
  );

  expect(await listLowContrastText(page)).toEqual([]);
});

test("the contrast check measures a part placed off the screen over its own row", async ({
  page,
}) => {
  await page.setContent(
    `<style>
      body { background: #fff }
      div { position: relative; background: rgba(0, 0, 0, 0.3) }
      span { position: absolute; left: -2000px; color: #666 }
    </style>
    <div><span>Rangers</span>&nbsp;</div>`,
  );

  expect(await listLowContrastText(page)).toEqual(['span. "Rangers": 2.71 to 1, under 4.5']);
});
