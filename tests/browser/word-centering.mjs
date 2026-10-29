const LIFT = "--word-lift";

/**
 * Lists the selectors of the rules that pad by the words' lift, from the page's stylesheets and
 * the rules grouped inside them.
 * @param {import("@playwright/test").Page} page
 */
function listLiftedSelectors(page) {
  return page.evaluate((lift) => {
    /** @param {CSSRuleList} rules @returns {CSSRule[]} */
    const flattenRules = (rules) =>
      [...rules].flatMap((rule) =>
        rule instanceof CSSGroupingRule ? flattenRules(rule.cssRules) : [rule],
      );
    return [...document.styleSheets]
      .flatMap((sheet) => flattenRules(sheet.cssRules))
      .filter(
        (rule) =>
          rule instanceof CSSStyleRule &&
          new RegExp(`padding[\\w-]*:[^;]*var\\(${lift}\\b`).test(rule.style.cssText),
      )
      .map((rule) => /** @type {CSSStyleRule} */ (rule).selectorText);
  }, LIFT);
}

/**
 * Measures, for each shown element the selectors match, how far its words' capitals sit under the
 * top of its row and how far their baseline sits over its bottom, inside its borders and over a
 * line drawn across its foot.
 * @param {import("@playwright/test").Page} page
 * @param {string[]} selectors
 */
function measureCapitals(page, selectors) {
  return page.evaluate(async (selectors) => {
    await document.fonts.ready;
    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d")
    );
    /** @param {Element} part */
    const readFootLine = (part) =>
      ["::before", "::after"]
        .map((pseudo) => getComputedStyle(part, pseudo))
        .filter(
          (style) =>
            style.content !== "none" && style.position === "absolute" && style.bottom === "0px",
        )
        .reduce((line, style) => Math.max(line, Number.parseFloat(style.height)), 0);
    return [...document.querySelectorAll(selectors.join(", "))]
      .filter((part) => part.getClientRects().length && part.checkVisibility())
      .map((part) => {
        const words = /** @type {Text} */ (
          [...part.childNodes].find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          )
        );
        const range = document.createRange();
        range.selectNodeContents(words);
        const style = getComputedStyle(part);
        context.font = style.font;
        const metrics = context.measureText(words.textContent ?? "");
        const baseline = range.getBoundingClientRect().top + metrics.fontBoundingBoxAscent;
        const capitalTop = baseline - context.measureText("H").actualBoundingBoxAscent;
        const box = part.getBoundingClientRect();
        const top = box.top + Number.parseFloat(style.borderTopWidth);
        const footLine = Math.max(
          readFootLine(part),
          part.parentElement?.getBoundingClientRect().bottom === box.bottom
            ? readFootLine(part.parentElement)
            : 0,
        );
        const bottom = box.bottom - Math.max(Number.parseFloat(style.borderBottomWidth), footLine);
        return {
          selector: selectors.find((selector) => part.matches(selector)),
          words: words.textContent?.trim(),
          above: capitalTop - top,
          below: bottom - baseline,
        };
      });
  }, selectors);
}

/**
 * @param {any} test
 * @param {any} expect
 * @param {{ openApp: (page: import("@playwright/test").Page) => Promise<unknown> }} options
 */
export function testWordCentering(test, expect, { openApp }) {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(
    ({ browserName }) => browserName !== "webkit",
    "Chromium sets Barlow's line a pixel higher than Safari, which the phone draws with",
  );

  test("every row padded by the words' lift centers its words' capitals", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    const selectors = await listLiftedSelectors(page);
    expect(selectors.length).toBeGreaterThan(0);
    await page.locator("#tab-search").tap();
    await page.locator("#gameSearch .search-example").first().waitFor();
    const examples = await measureCapitals(page, selectors);
    await page.locator("#gameSearch .search-input").pressSequentially("sett");
    await page.locator("#gameSearch .search-suggestion .search-words").first().waitFor();
    const suggestions = await measureCapitals(page, selectors);
    await page.locator("#settingsBtn").click();
    await page.locator("#contactBtn").click();
    await page.locator("#contactDialog .settings-page-row").first().waitFor();
    const settings = await measureCapitals(page, selectors);
    const rows = [...examples, ...suggestions, ...settings];
    expect(new Set(rows.map(({ selector }) => selector))).toEqual(new Set(selectors));
    for (const { words, above, below } of rows)
      expect({ words, off: Math.abs(above - below) <= 1 ? "centered" : above - below }).toEqual({
        words,
        off: "centered",
      });
  });
}
