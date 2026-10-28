/**
 * Reads the color a token of the page's theme names, as the page draws it.
 * @param {import("@playwright/test").Page} page
 * @param {string} token
 */
export const readTokenColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
