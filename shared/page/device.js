// What kind of device and browser the page is open in, and what its viewer asks of it. An iPad
// says it's a Mac, so its touch screen gives it away.

export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isOnHomeScreen = () =>
  matchMedia("(display-mode: standalone)").matches ||
  /** @type {{ standalone?: boolean }} */ (navigator).standalone === true;

// A phone or tablet: touch is how it points, and nothing hovers.
export const isTouchDevice = () => matchMedia("(hover: none) and (pointer: coarse)").matches;

// A screen as narrow as chrome.css's phone layout, where a dialog is a sheet over the whole screen.
export const PHONE_WIDTH_QUERY = "(max-width: 779px)";

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
