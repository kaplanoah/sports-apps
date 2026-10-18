// Where the title row's parts sit around the app's name, measured from the fonts it draws in.

/**
 * How far the channel tag's middle sits below the middle of the name's capitals, in pixels, or
 * above it when negative.
 * @param {import("@playwright/test").Page} page
 */
export async function readTagOffset(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const h1 = /** @type {HTMLElement} */ (document.querySelector("header.top h1"));
    const name = /** @type {Text} */ (
      [...h1.childNodes].findLast(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      )
    );
    const probe = document.createElement("span");
    probe.style.cssText = "display: inline-block; width: 0; height: 0; vertical-align: baseline";
    name.after(probe);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    const style = getComputedStyle(h1);
    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d")
    );
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const capHeight = context.measureText("H").actualBoundingBoxAscent;
    const tag = /** @type {HTMLElement} */ (
      document.getElementById("channelTag")
    ).getBoundingClientRect();
    return tag.top + tag.height / 2 - (baseline - capHeight / 2);
  });
}

/**
 * The room between the box of the name's last letter and the season's year.
 * @param {import("@playwright/test").Page} page
 */
export async function readYearGap(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const h1 = /** @type {HTMLElement} */ (document.querySelector("header.top h1"));
    const name = /** @type {Text} */ (
      [...h1.childNodes].findLast(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      )
    );
    const letters = name.textContent?.trim() ?? "";
    const range = document.createRange();
    const start = (name.textContent ?? "").indexOf(letters);
    range.setStart(name, start);
    range.setEnd(name, start + letters.length);
    const year = /** @type {HTMLElement} */ (document.getElementById("titleYear"));
    return year.getBoundingClientRect().left - range.getBoundingClientRect().right;
  });
}

/**
 * The season year's letter spacing, in ems of its size.
 * @param {import("@playwright/test").Page} page
 */
export const readYearTracking = (page) =>
  page.locator("#titleYear").evaluate((year) => {
    const style = getComputedStyle(year);
    return parseFloat(style.letterSpacing) / parseFloat(style.fontSize);
  });
