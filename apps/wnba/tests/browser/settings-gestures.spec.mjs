import { test, expect, openApp } from "./harness.mjs";
import {
  checkSeasonPickerDrag,
  checkSettingsSheetDrag,
} from "../../../../tests/browser/settings-gestures.mjs";
import { ONE_PAST_SEASON } from "./past-season.mjs";

import { NEXT_RELEASE, serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

for (const reducedMotion of /** @type {("reduce" | "no-preference")[]} */ ([
  "reduce",
  "no-preference",
])) {
  test.describe(`with ${reducedMotion} motion`, () => {
    test.use({ contextOptions: { reducedMotion } });
    test("a drag outside the controls still moves settings down and closes them", async ({
      page,
    }) => {
      await openApp(page, ONE_PAST_SEASON);
      await checkSettingsSheetDrag(page);
    });
    for (const [direction, distance] of /** @type {[string, number][]} */ ([
      ["up", -60],
      ["down", 160],
    ])) {
      test(`a drag ${direction} on the Season picker never moves settings, including after release`, async ({
        page,
      }) => {
        await openApp(page, ONE_PAST_SEASON);
        await checkSeasonPickerDrag(page, distance);
      });
    }
  });
}

test("production keeps a one-season picker hidden", async ({ page }) => {
  await serveReleases(page, NEXT_RELEASE);
  await openApp(page);
  await openSettings(page);
  await expect(page.locator("#seasonPicker option")).toHaveCount(1);
  await expect(page.locator("#seasonRow")).toBeHidden();
});

test.describe("beta with a one-season picker", () => {
  test.beforeEach(async ({ page }) => {
    await serveReleases(page, { ...NEXT_RELEASE, label: "beta" });
    await openApp(page);
    await expect(page.locator("#seasonPicker option")).toHaveCount(1);
  });

  for (const reducedMotion of /** @type {("reduce" | "no-preference")[]} */ ([
    "reduce",
    "no-preference",
  ])) {
    test.describe(`with ${reducedMotion} motion`, () => {
      test.use({ contextOptions: { reducedMotion } });
      test("a drag outside the controls still moves settings down and closes them", async ({
        page,
      }) => {
        await checkSettingsSheetDrag(page);
      });
      for (const [direction, distance] of /** @type {[string, number][]} */ ([
        ["up", -60],
        ["down", 160],
      ])) {
        test(`a drag ${direction} on the Season picker never moves settings, including after release`, async ({
          page,
        }) => {
          await checkSeasonPickerDrag(page, distance, null);
        });
      }
    });
  }
});
