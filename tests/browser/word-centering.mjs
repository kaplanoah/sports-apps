import { readCapitals } from "./capitals.mjs";

const LIFT = "--word-lift";

/**
 * Lists the rules that lift words by the words' lift, from the page's stylesheets and the rules
 * nested inside them, each with whether it pads its own row or sets margins inside its parent's.
 * @param {import("@playwright/test").Page} page
 */
function listLiftedRules(page) {
  return page.evaluate((lift) => {
    /** @param {CSSRuleList} rules @returns {CSSRule[]} */
    const flattenRules = (rules) =>
      [...rules].flatMap((rule) => [
        rule,
        ...("cssRules" in rule ? flattenRules(/** @type {CSSGroupingRule} */ (rule).cssRules) : []),
      ]);
    const readLiftedSide = (/** @type {CSSStyleRule} */ rule) =>
      new RegExp(`(padding|margin)[\\w-]*:[^;]*var\\(${lift}\\b`).exec(rule.style.cssText)?.[1];
    return [...document.styleSheets]
      .flatMap((sheet) => flattenRules(sheet.cssRules))
      .filter((rule) => rule instanceof CSSStyleRule && readLiftedSide(rule))
      .map((rule) => ({
        selector: /** @type {CSSStyleRule} */ (rule).selectorText,
        isPadded: readLiftedSide(/** @type {CSSStyleRule} */ (rule)) === "padding",
      }));
  }, LIFT);
}

/**
 * Measures where the row around a part starts and ends, inside its borders and over a line drawn
 * across its foot, and whether the part's words sit on one line.
 * @param {import("@playwright/test").Locator} part
 * @param {boolean} isPadded whether the part is its own row, or sits in its parent's
 */
function measureRow(part, isPadded) {
  return part.evaluate((element, isPadded) => {
    const row = /** @type {Element} */ (isPadded ? element : element.parentElement);
    /** @param {Element} box */
    const readFootLine = (box) =>
      ["::before", "::after"]
        .map((pseudo) => getComputedStyle(box, pseudo))
        .filter(
          (style) =>
            style.content !== "none" && style.position === "absolute" && style.bottom === "0px",
        )
        .reduce((line, style) => Math.max(line, Number.parseFloat(style.height)), 0);
    const style = getComputedStyle(row);
    const box = row.getBoundingClientRect();
    const footLine = Math.max(
      readFootLine(row),
      row.parentElement?.getBoundingClientRect().bottom === box.bottom
        ? readFootLine(row.parentElement)
        : 0,
    );
    const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const lineTops = new Set();
    for (let text = texts.nextNode(); text; text = texts.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects())
        if (rect.height) lineTops.add(Math.round(rect.top));
    }
    return {
      words: element.textContent?.trim(),
      top: box.top + Number.parseFloat(style.borderTopWidth),
      bottom: box.bottom - Math.max(Number.parseFloat(style.borderBottomWidth), footLine),
      isOneLine: lineTops.size === 1,
    };
  }, isPadded);
}

/**
 * Measures, for each shown part on one line that a lifted rule matches, how far its words'
 * capitals sit under the top of its row and how far their baseline sits over its foot.
 * @param {import("@playwright/test").Page} page
 * @param {{ selector: string, isPadded: boolean }[]} rules
 */
async function measureCapitals(page, rules) {
  await page.evaluate(() => document.fonts.ready);
  const measured = await Promise.all(
    rules.map(async ({ selector, isPadded }) => {
      const parts = await page.locator(selector).filter({ visible: true }).all();
      return Promise.all(
        parts.map(async (part) => {
          const [capitals, row] = await Promise.all([
            readCapitals(part),
            measureRow(part, isPadded),
          ]);
          return {
            selector,
            words: row.words,
            isOneLine: row.isOneLine,
            above: capitals.top - row.top,
            below: row.bottom - capitals.bottom,
          };
        }),
      );
    }),
  );
  return measured.flat().filter(({ isOneLine }) => isOneLine);
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

  test("every row lifted by the words' lift centers its words' capitals", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    const rules = await listLiftedRules(page);
    expect(rules.length).toBeGreaterThan(0);
    await page.locator("#tab-search").tap();
    await page.locator("#gameSearch .search-example").first().waitFor();
    const examples = await measureCapitals(page, rules);
    await page.locator("#gameSearch .search-input").pressSequentially("sett");
    await page.locator("#gameSearch .search-suggestion .search-words").first().waitFor();
    const pageRows = await measureCapitals(page, rules);
    await page.locator("#gameSearch .search-input").fill("");
    await page.locator("#gameSearch .search-example").last().tap();
    await page.locator("#gameSearch .search-detail").first().waitFor();
    const suggestions = await measureCapitals(page, rules);
    await page.locator("#settingsBtn").click();
    await page.locator("#diagnosticsSwitch").waitFor();
    const settings = await measureCapitals(page, rules);
    await page.locator("#contactBtn").click();
    await page.locator("#contactDialog .settings-page-row").first().waitFor();
    const contact = await measureCapitals(page, rules);
    const rows = [...examples, ...pageRows, ...suggestions, ...settings, ...contact];
    expect(new Set(rows.map(({ selector }) => selector))).toEqual(
      new Set(rules.map(({ selector }) => selector)),
    );
    for (const { words, above, below } of rows)
      expect({ words, off: Math.abs(above - below) <= 1 ? "centered" : above - below }).toEqual({
        words,
        off: "centered",
      });
  });
}
