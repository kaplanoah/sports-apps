import { test, openApp } from "./harness.mjs";
import {
  checkSeasonPickerDrag,
  checkSettingsSheetDrag,
} from "../../../../tests/browser/settings-gestures.mjs";
import { ONE_PAST_SEASON } from "./past-season.mjs";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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
