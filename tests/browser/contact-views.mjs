/** @param {import("@playwright/test").Page} page @param {string} [category] */
async function openContactView(page, category) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#contactBtn").click();
  if (category)
    await page
      .locator("#contactDialog")
      .getByRole("button", { name: category, exact: true })
      .click();
}

/** @param {import("@playwright/test").Page} page */
async function closeContactView(page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

export const CONTACT_VIEWS = [
  {
    name: "Contact menu",
    open: (page) => openContactView(page),
    shown: (page) => page.locator("#contactDialog .contact-menu"),
    close: closeContactView,
  },
  ...["Bug report", "Feature request", "Something else"].map((category) => ({
    name: category,
    open: (page) => openContactView(page, category),
    shown: (page) => page.locator("#contactMessage"),
    close: closeContactView,
  })),
];
