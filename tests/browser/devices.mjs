export const IPHONE_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// Safari on an iPad names itself a Mac, as it has since iPadOS 13.
export const IPAD_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
export const ANDROID_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
export const IPAD = {
  viewport: { width: 1180, height: 820 },
  hasTouch: true,
  isMobile: true,
  userAgent: IPAD_AGENT,
};
export const IPHONE = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent: IPHONE_AGENT,
};
// The widest iPhone, as an iPhone 16 or 17 Pro Max's Safari lays its pages out.
export const WIDE_IPHONE = { ...IPHONE, viewport: { width: 440, height: 956 } };
export const ANDROID_PHONE = { ...IPHONE, userAgent: ANDROID_AGENT };
// What tells a real iPad from a Mac, which its agent alone can't: a Mac's platform with a touch
// screen. A trackpad leaves both as they are.
/** @param {import("@playwright/test").Page} page */
export const fakeIpadPlatform = (page) =>
  page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 });
  });
// A browser without push, as Safari is outside the Home Screen.
/** @param {import("@playwright/test").Page} page */
export const takeAwayPush = (page) =>
  page.addInitScript(() => {
    delete (/** @type {any} */ (window).PushManager);
  });
