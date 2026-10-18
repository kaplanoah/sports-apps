// Where the title row's parts sit around the app's name, measured from the fonts it draws in.

/**
 * The text of the app's name in the title, the last of the title's words before the year, once
 * its fonts have loaded.
 * @param {import("@playwright/test").Page} page
 */
async function findName(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluateHandle(
    () =>
      /** @type {Text} */ (
        [...(document.querySelector("header.top h1")?.childNodes ?? [])].findLast(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        )
      ),
  );
}

/**
 * How far the channel tag's middle sits below the middle of the name's capitals, in pixels, or
 * above it when negative.
 * @param {import("@playwright/test").Page} page
 */
export async function readTagOffset(page) {
  const name = await findName(page);
  return name.evaluate((text) => {
    const h1 = /** @type {HTMLElement} */ (text.parentElement);
    const probe = document.createElement("span");
    probe.style.cssText = "display: inline-block; width: 0; height: 0; vertical-align: baseline";
    text.after(probe);
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
  const name = await findName(page);
  return name.evaluate((text) => {
    const letters = text.textContent?.trim() ?? "";
    const start = (text.textContent ?? "").indexOf(letters);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + letters.length);
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
