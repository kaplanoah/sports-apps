/**
 * @param {import("@playwright/test").Page} page
 * @param {string} choice
 */
export async function chooseAppearance(page, choice) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "Appearance" })
    .getByRole("radio", { name: choice })
    .check();
  await page.keyboard.press("Escape");
}

/**
 * The color a CSS color value resolves to on the page, like a mix of its tokens.
 * @param {import("@playwright/test").Page} page
 * @param {string} value
 */
export const readColor = (page, value) =>
  page.evaluate((cssColor) => {
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.color = cssColor;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, value);

/**
 * The color a page token resolves to.
 * @param {import("@playwright/test").Page} page
 * @param {string} token
 */
export const readTokenColor = (page, token) => readColor(page, `var(${token})`);
