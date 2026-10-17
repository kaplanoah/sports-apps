/**
 * How far the Home Screen steps' numbers sit below their circles' middle, in pixels to the nearest
 * half, measured from where the font draws the digits' ink, all of them together, rather than
 * their line.
 * @param {import("@playwright/test").Page} page
 */
export async function measureStepNumbers(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.locator("#homeScreenWelcome .welcome-steps > li:visible").evaluateAll((steps) => {
    const circle = getComputedStyle(steps[0], "::before");
    const context = document.createElement("canvas").getContext("2d");
    context.font = `${circle.fontWeight} ${circle.fontSize} ${circle.fontFamily}`;
    const digits = context.measureText(steps.map((_, index) => index + 1).join(""));
    const lineHeight = digits.fontBoundingBoxAscent + digits.fontBoundingBoxDescent;
    const height = parseFloat(circle.height);
    const room = height - parseFloat(circle.paddingTop) - parseFloat(circle.paddingBottom);
    const baseline = (room - lineHeight) / 2 + digits.fontBoundingBoxAscent;
    const inkMiddle =
      baseline - (digits.actualBoundingBoxAscent - digits.actualBoundingBoxDescent) / 2;
    return Math.round((inkMiddle - height / 2) * 2) / 2;
  });
}
