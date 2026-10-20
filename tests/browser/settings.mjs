export const SETTINGS = "#settingsDialog";

/**
 * Opens settings from its button, which every app's page has.
 * @param {import("@playwright/test").Page} page
 */
export const openSettings = (page) =>
  page.getByRole("button", { name: "Settings", exact: true }).click();
