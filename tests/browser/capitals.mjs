/**
 * Where the capitals of the first shown words in what `locator` finds are drawn, measured from the
 * top of the viewport.
 * @param {import("@playwright/test").Locator} locator
 * @returns {Promise<{ top: number, middle: number, bottom: number }>}
 */
export const readCapitals = (locator) =>
  locator.evaluate((element) => {
    const words = /** @type {Text} */ (
      document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT, (node) =>
          node.textContent?.trim() && node.parentElement?.checkVisibility()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP,
        )
        .nextNode()
    );
    const holder = /** @type {Element} */ (words.parentElement);
    const style = getComputedStyle(holder);
    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d")
    );
    // Measured large and scaled down, since a canvas rounds its text's bounds to whole pixels.
    context.font = `${style.fontWeight} 1000px ${style.fontFamily}`;
    const capHeight =
      (context.measureText("H").actualBoundingBoxAscent * parseFloat(style.fontSize)) / 1000;
    // A zero-height box set inline after a text has its top on the text's baseline. In a flex or
    // grid, the words and the box would each be an item of their own, so they share a span there.
    const probe = document.createElement("span");
    probe.style.cssText = "display: inline-block; width: 0; height: 0";
    const line = /(flex|grid)$/.test(style.display) ? document.createElement("span") : null;
    if (line) {
      words.replaceWith(line);
      line.append(words, probe);
    } else words.after(probe);
    const baseline = probe.getBoundingClientRect().top;
    if (line) line.replaceWith(words);
    else probe.remove();
    return { top: baseline - capHeight, middle: baseline - capHeight / 2, bottom: baseline };
  });
