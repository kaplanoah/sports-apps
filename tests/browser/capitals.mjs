/**
 * Where the capitals of the text `locator` finds are drawn, measured from the top of the viewport.
 * @param {import("@playwright/test").Locator} locator
 * @returns {Promise<{ top: number, middle: number, bottom: number }>}
 */
export const readCapitals = (locator) =>
  locator.evaluate((text) => {
    const style = getComputedStyle(text);
    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d")
    );
    // Measured large and scaled down, since a canvas rounds its text's bounds to whole pixels.
    context.font = `${style.fontWeight} 1000px ${style.fontFamily}`;
    const capHeight =
      (context.measureText("H").actualBoundingBoxAscent * parseFloat(style.fontSize)) / 1000;
    // A zero-height box set inline after a text has its top on the text's baseline.
    const probe = document.createElement("span");
    probe.style.cssText = "display: inline-block; width: 0; height: 0";
    text.append(probe);
    const baseline = probe.getBoundingClientRect().top;
    probe.remove();
    return { top: baseline - capHeight, middle: baseline - capHeight / 2, bottom: baseline };
  });
