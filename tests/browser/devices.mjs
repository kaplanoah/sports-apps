export const IPHONE_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
export const IPAD = {
  viewport: { width: 1180, height: 820 },
  hasTouch: true,
  isMobile: true,
  userAgent: IPHONE_AGENT.replace("iPhone; CPU iPhone OS", "iPad; CPU OS"),
};
export const ANDROID_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
