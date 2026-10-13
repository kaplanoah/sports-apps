/**
 * The text of every shown block on the page, as one line each, but an outlet's own words, which a
 * page marks with data-quoted, and text hidden for screen readers.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listShownTexts = (page) =>
  page.evaluate(() => {
    /** @param {Element} element */
    const isScreenReaderOnly = (element) => {
      const box = element.getBoundingClientRect();
      return box.width <= 1 || box.height <= 1;
    };

    /** The nearest element around `element` that isn't laid out in a line of text. @param {Element} element */
    const findBlock = (element) => {
      let block = element;
      while (block.parentElement && getComputedStyle(block).display.startsWith("inline"))
        block = block.parentElement;
      return block;
    };

    const blocks = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim() || !element.checkVisibility()) continue;
      if (element.closest("[data-quoted]") || isScreenReaderOnly(element)) continue;
      blocks.add(findBlock(element));
    }
    return [...blocks].map((block) => block.textContent.replace(/\s+/g, " ").trim());
  });
