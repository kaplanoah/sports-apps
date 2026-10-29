import { checkBracketPull, readGeometry } from "../../../../tests/browser/bracket-pull.mjs";
import { waitForLoadToSettle } from "../../../../tests/browser/at-rest.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { drag, openFromHomeScreen, PULL_START } from "../../../../tests/browser/touch.mjs";
import { test, expect, openApp } from "./harness.mjs";

checkBracketPull({ test, openApp, cards: ".box", sideways: "#bracketWrap .tree-scroll" });

test("a stacked bracket keeps its gaps during a pull when its tab bar is in the page's flow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 830 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openSeasonPart(page, "Bracket");
  await waitForLoadToSettle(page);
  await expect(page.locator("#tabBar")).not.toHaveCSS("position", "fixed");
  await expect(page.locator(".tree-scroll")).toHaveClass(/stacked/);
  const geometry = await readGeometry(page, ".box");
  const liftFinger = await drag(page, PULL_START, { y: 60 });
  await expect(page.locator("header.top")).toHaveCSS("top", "25px");
  await expect(page.locator(".pull-refresh")).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("resize")));
  await page.clock.runFor(100);
  await waitForLoadToSettle(page);
  expect(await readGeometry(page, ".box")).toEqual(geometry);
  await liftFinger();
  await expect(page.locator(".pull-refresh")).toBeHidden();
  expect(await readGeometry(page, ".box")).toEqual(geometry);
});
