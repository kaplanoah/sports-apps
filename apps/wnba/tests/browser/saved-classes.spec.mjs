import { test, openApp } from "./harness.mjs";
import {
  expectLegacySavedClassesAreLeftOut,
  expectMarkupClassesSaved,
  expectSavedClassesFitLayout,
} from "../../../../tests/browser/saved-classes.mjs";

// The classes the page puts back on a part it drew whole, before its modules load.

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

test("a part put back from a copy saved under another layout takes only its code's classes", async ({
  page,
}) => {
  await expectSavedClassesFitLayout(page, () => openApp(page));
});

test("a part put back from a copy saved before the page kept its markup's classes takes none", async ({
  page,
}) => {
  await expectLegacySavedClassesAreLeftOut(page, () => openApp(page));
});

test("a part saved as the page leaves keeps the classes its markup gave it beside its own", async ({
  page,
}) => {
  await expectMarkupClassesSaved(page, () => openApp(page));
});
