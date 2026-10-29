import {
  checkAlignmentAttachments,
  checkAlignmentControls,
  checkAlignmentCopy,
  checkAlignmentReloadAndReset,
  checkAlignmentCardFit,
  checkAlignmentRoleControl,
  checkAlignmentStaysOutOfProduction,
} from "../../../../tests/browser/tuning-panel.mjs";
import { test, openApp } from "./harness.mjs";
import { openWithEverything } from "./views.mjs";

test.use({ hasTouch: true, contextOptions: { reducedMotion: "reduce" } });

const APP = "wnba";

for (const width of [390, 1280]) {
  for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
    test(`the alignment roles, pixel sizes and Down-left controls work at ${width}px in ${colorScheme}`, async ({
      page,
    }) => {
      test.slow();
      await checkAlignmentControls({ page, app: APP, openApp }, { width, colorScheme });
    });
  }
}

test("alignment attachments move in the real standings or bracket and reset", async ({ page }) => {
  test.slow();
  await checkAlignmentAttachments({ page, app: APP, openApp });
});

test("Copy includes every role even when its controls are hidden", async ({ page }) => {
  test.slow();
  await checkAlignmentCopy({ page, app: APP, openApp });
});

test("hidden role choices survive reload and reset independently", async ({ page }) => {
  test.slow();
  test.setTimeout(test.info().timeout * 2);
  await checkAlignmentReloadAndReset({ page, app: APP, openApp });
});

test("live Small typography refits the real team-sheet game cards", async ({ page }) => {
  test.slow();
  await checkAlignmentCardFit({ page, app: APP, openApp });
});

test("the actual alignment round and saved beta choices never affect production", async ({
  page,
}) => {
  test.slow();
  test.setTimeout(test.info().timeout * 2);
  await checkAlignmentStaysOutOfProduction({ page, app: APP, openApp });
});

for (const role of ["Small", "Team", "Large", "Label"]) {
  for (const label of ["Name size", "Name weight", "Dot size", "Dot before name"]) {
    test(`${role} ${label} changes its real team line and resets`, async ({ page }) => {
      test.slow();
      await checkAlignmentRoleControl(
        { page, app: APP, openApp: role === "Label" ? openWithEverything : openApp },
        role,
        label,
      );
    });
  }
}
