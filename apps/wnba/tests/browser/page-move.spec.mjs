import { test, MOVING_APP } from "./harness.mjs";
import { ANDROID_PHONE, IPHONE } from "../../../../tests/browser/devices.mjs";
import {
  checkMoveCard,
  checkMoveCardDismissal,
  checkMoveCardStandIns,
  checkMovingIconFollowsTheme,
  checkMovingIconPick,
  checkMovingWelcome,
  checkMovingWelcomeCloses,
  checkNotificationsAsk,
  checkNotificationsAskGoes,
  checkSafariMoves,
  checkTurnOn,
} from "../../../../tests/browser/page-move.mjs";

// Moving fans from the app's old address to its own, with their choices, as a Worker that moves them does.

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("on an iPhone", () => {
  test.use(IPHONE);

  test("Safari signed in at the old address leaves for the new one, signed in, with its choices", async ({
    page,
    browser,
  }) => {
    await checkSafariMoves({ page, browser, ...MOVING_APP });
  });

  test("the Home Screen app at the old address shows the card for the new site", async ({
    page,
    browser,
  }) => {
    await checkMoveCard({ page, browser, ...MOVING_APP });
  });

  test("the card's X takes it away for good", async ({ page, browser }) => {
    await checkMoveCardDismissal({ page, browser, ...MOVING_APP });
  });

  test("on the season tab, a tap on the card's X under the riding header takes it away", async ({
    page,
    browser,
  }) => {
    await checkMoveCardStandIns({ page, browser, ...MOVING_APP });
  });

  test("the new Home Screen app asks to turn notifications on again", async ({ page, browser }) => {
    await checkNotificationsAsk({ page, browser, ...MOVING_APP });
  });

  test("Leave off takes the notifications ask away for good", async ({ page, browser }) => {
    await checkNotificationsAskGoes({ page, browser, ...MOVING_APP }, "Leave off");
  });

  test("the X takes the notifications ask away for good", async ({ page, browser }) => {
    await checkNotificationsAskGoes({ page, browser, ...MOVING_APP }, "Dismiss notifications");
  });

  test("Turn on subscribes the phone, and the notifications ask goes", async ({
    page,
    browser,
  }) => {
    await checkTurnOn({ page, browser, ...MOVING_APP });
  });
});

// An iPhone's Home Screen app hands Safari the new site under a scheme no test browser follows,
// so Android's opens it.
test.describe("from an Android phone's Home Screen app", () => {
  test.use(ANDROID_PHONE);

  test("Use new site opens the welcome's steps for finishing the move", async ({
    page,
    browser,
  }) => {
    await checkMovingWelcome({ page, browser, ...MOVING_APP });
  });

  test("the moving welcome starts on the icon of the theme picked last", async ({
    page,
    browser,
  }) => {
    await checkMovingIconFollowsTheme({ page, browser, ...MOVING_APP });
  });

  test("a pick in the moving welcome changes only the icon", async ({ page, browser }) => {
    await checkMovingIconPick({ page, browser, ...MOVING_APP });
  });

  test("closing the moving welcome ends the move", async ({ page, browser }) => {
    await checkMovingWelcomeCloses({ page, browser, ...MOVING_APP });
  });
});
