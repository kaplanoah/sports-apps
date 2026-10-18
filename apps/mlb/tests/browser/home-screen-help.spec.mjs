import { ANDROID_AGENT, IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import {
  checkCaretBeforeCode,
  checkHelpOpensWelcome,
  checkMenuDots,
  checkPickKeepsWelcome,
  checkUnsupportedNote,
  checkWelcomeRises,
  checkWelcomeSwipesDown,
} from "../../../../tests/browser/home-screen-help.mjs";
import { test, openApp, openSettings, ON_A_PHONE } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("on an iPhone, in the browser", () => {
  test.use({ ...ON_A_PHONE, userAgent: IPHONE_AGENT });

  test("the Notifications note says why to add the page to the home screen, ending with a ? that opens the welcome over settings, which its caret and Escape close", async ({
    page,
  }) => {
    await checkHelpOpensWelcome({ page, openApp, openSettings });
  });

  test("the welcome from the ? rises as settings does, and its caret slides it down, while a first visit's is there from the start", async ({
    page,
  }) => {
    await checkWelcomeRises({ page, openApp, openSettings });
  });

  test("a swipe down too short springs the welcome back, and a flick down closes it to settings", async ({
    page,
  }) => {
    await checkWelcomeSwipesDown({ page, openApp, openSettings });
  });

  test("in Safari, a theme picked on the welcome from the ? loads the page again still on the welcome, which stays closed once it closes", async ({
    page,
  }) => {
    await checkPickKeepsWelcome({ page, openApp, openSettings, darkLook: "Night Game" });
  });

  test("before the page's code arrives, the welcome's caret closes it for good", async ({
    page,
  }) => {
    await checkCaretBeforeCode({ page, openApp, openSettings });
  });
});

test.describe("on an iPad, in the browser", () => {
  test.use({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    isMobile: true,
    userAgent: IPHONE_AGENT.replace("iPhone; CPU iPhone OS", "iPad; CPU OS"),
  });

  test("the Notifications note and its ? are the iPhone's", async ({ page }) => {
    await checkHelpOpensWelcome({ page, openApp, openSettings });
  });
});

test.describe("on an Android phone, in the browser", () => {
  test.use({ ...ON_A_PHONE, userAgent: ANDROID_AGENT });

  test("the menu's dots sit as set by eye in the welcome and the settings' box", async ({
    page,
  }) => {
    await checkMenuDots({ page, openApp, openSettings });
  });
});

test("a browser that can't show notifications says what to try, with no ?", async ({ page }) => {
  await checkUnsupportedNote({ page, openApp, openSettings });
});
