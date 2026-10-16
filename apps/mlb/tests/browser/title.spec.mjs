import { test, expect, openApp } from "./harness.mjs";
import { readTitleGaps } from "../../../../tests/browser/title-gaps.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("the title's name sets M and L 0.04em apart and L and B 0.005em", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("header.top h1")).toHaveText("MLB");
  expect(await readTitleGaps(page)).toEqual([0.04, 0.005]);
});
