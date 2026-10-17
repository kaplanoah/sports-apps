export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

export const WELCOME = "#homeScreenWelcome";
export const CONTINUE = { name: "Continue in browser" };

/** @param {import("@playwright/test").Page} page */
export const openSettings = (page) =>
  page.getByRole("button", { name: "Settings", exact: true }).click();
