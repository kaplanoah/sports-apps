import { IPHONE } from "../../../../tests/browser/devices.mjs";
import {
  checkMovingWelcome,
  checkNeverMoves,
  checkNoAskWhenOff,
  checkNotificationsAsk,
  checkTurnOnFromAsk,
} from "../../../../tests/browser/page-move.mjs";
import { test, openApp, serveLockedApp } from "./harness.mjs";
import { LEAGUE_WORDS } from "../../page/js/league-words.js";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("on an iPhone", () => {
  test.use(IPHONE);

  test("the old address stays put while the app isn't moving", ({ page }) =>
    checkNeverMoves({ page, serveLockedApp }));

  test("the moving welcome picks only the icon", ({ page }) =>
    checkMovingWelcome({
      page,
      openApp,
      looks: { light: "Maple", dark: "Walnut" },
      appName: "WNBA",
      neverShown: LEAGUE_WORDS.neverShown,
    }));

  test("Leave off answers the notifications ask for good", ({ page }) =>
    checkNotificationsAsk({ page, openApp, name: "Leave off" }));

  test("the X answers the notifications ask for good", ({ page }) =>
    checkNotificationsAsk({ page, openApp, name: "Dismiss notifications ask" }));

  test("a move with notifications off asks nothing", ({ page }) =>
    checkNoAskWhenOff({ page, openApp }));

  test.describe("with push", () => {
    // Turn on subscribes through the page's service worker.
    test.use({ serviceWorkers: "allow" });

    test("Turn on in the notifications ask turns notifications on", ({ page }) =>
      checkTurnOnFromAsk({ page, openApp }));
  });
});
