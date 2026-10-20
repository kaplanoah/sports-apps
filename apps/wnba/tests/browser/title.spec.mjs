import { test, expect, openApp } from "./harness.mjs";
import { readTitleGaps } from "../../../../tests/browser/title-gaps.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("the title's name sets W and N, and N and B, 0.025em apart, and B and A 0.065em", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator("header.top h1")).toHaveText("WNBA");
  expect(await readTitleGaps(page)).toEqual([0.025, 0.025, 0.065]);
});
