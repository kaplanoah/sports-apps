// What kind of device and browser the page is open in, and what its viewer asks of it. An iPad
// says it's a Mac, so its touch screen gives it away.

export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isOnHomeScreen = () =>
  matchMedia("(display-mode: standalone)").matches ||
  /** @type {{ standalone?: boolean }} */ (navigator).standalone === true;

// A screen as narrow as a phone's, where sheets fill it and the shared stylesheets lay the page out
// for a phone, as their own (max-width: 779px) rules do.
export const PHONE_WIDTH_QUERY = "(max-width: 779px)";

// A phone or tablet: touch is how it points, and nothing hovers.
export const isTouchDevice = () => matchMedia("(hover: none) and (pointer: coarse)").matches;

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
