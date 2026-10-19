import {
  ANDROID_AGENT,
  IPAD,
  IPHONE_AGENT,
  WIDE_IPHONE,
} from "../../../../tests/browser/devices.mjs";
import {
  checkCaretBeforeCode,
  checkCaretPlace,
  checkCaretPlaceOnTablet,
  checkHelpOpensWelcome,
  checkMenuDots,
  checkNoHelpWithoutTouch,
  checkPickKeepsWelcome,
  checkRiseAfterEarlyClose,
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

  test("a welcome closed before the page's code arrived rises when the ? opens it again", async ({
    page,
  }) => {
    await checkRiseAfterEarlyClose({ page, openApp, openSettings });
  });

  test("the welcome's caret from the ? sits over settings' caret, 14px over the heading", async ({
    page,
  }) => {
    await checkCaretPlace({ page, openApp, openSettings });
  });

  test("before the page's code arrives, the welcome's caret closes it for good", async ({
    page,
  }) => {
    await checkCaretBeforeCode({ page, openApp, openSettings });
  });
});

test.describe("on the widest iPhone, in the browser", () => {
  test.use(WIDE_IPHONE);

  test("the welcome's caret from the ? still sits over settings' caret, where the welcome's column has wider sides", async ({
    page,
  }) => {
    await checkCaretPlace({ page, openApp, openSettings });
  });
});

test.describe("on an iPad, in the browser", () => {
  test.use(IPAD);

  test("the Notifications note and its ? are the iPhone's", async ({ page }) => {
    await checkHelpOpensWelcome({ page, openApp, openSettings });
  });

  test("the welcome's caret from the ? reaches out past its words as a sheet's does, 14px over the heading", async ({
    page,
  }) => {
    await checkCaretPlaceOnTablet({ page, openApp, openSettings });
  });
});

test.describe("on an iPad with a trackpad, in the browser", () => {
  test.use({ userAgent: IPAD.userAgent });

  test("the Notifications note says why to add the page to the home screen, with no ? where the welcome isn't drawn", async ({
    page,
  }) => {
    await checkNoHelpWithoutTouch({ page, openApp, openSettings });
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
