import {
  checkAlignmentAttachments,
  checkAlignmentControls,
  checkAlignmentCopyAndReload,
  checkAlignmentRoleTypography,
  checkAlignmentStaysOutOfProduction,
} from "../../../../tests/browser/tuning-panel.mjs";
import { test, openApp } from "./harness.mjs";
import { openWithEverything } from "./views.mjs";

test.use({ hasTouch: true, contextOptions: { reducedMotion: "reduce" } });

const APP = "mlb";

for (const width of [390, 1280]) {
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    test(`the alignment roles, pixel sizes and Down-left controls work at ${width}px in ${colorScheme}`, ({
      page,
    }) => checkAlignmentControls({ page, app: APP, openApp }, { width, colorScheme }));
  }
}

test("alignment attachments move in the real standings or bracket and reset", async ({ page }) => {
  test.slow();
  await checkAlignmentAttachments({ page, app: APP, openApp });
});

test("Copy includes hidden roles, and role choices and settings survive reload and reset", async ({
  page,
}) => {
  test.slow();
  await checkAlignmentCopyAndReload({ page, app: APP, openApp });
});

test("the actual alignment round and saved beta choices never affect production", async ({
  page,
}) => {
  test.slow();
  await checkAlignmentStaysOutOfProduction({ page, app: APP, openApp });
});

for (const role of ["Small", "Team", "Large", "Label"]) {
  test(`${role} controls change real names and dots and reset to the baseline`, async ({
    page,
  }) => {
    test.slow();
    await checkAlignmentRoleTypography({ page, app: APP, openApp: openWithEverything }, role);
  });
}
