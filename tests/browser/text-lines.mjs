/**
 * How many lines the text in each element `locator` finds is drawn on, leaving out icons and
 * other boxes beside it.
 * @param {import("@playwright/test").Locator} locator
 */
export const countTextLines = (locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const lineTops = new Set();
      for (let text = texts.nextNode(); text; text = texts.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(text);
        for (const rect of range.getClientRects())
          if (rect.width > 0) lineTops.add(Math.round(rect.top));
      }
      return lineTops.size;
    }),
  );
