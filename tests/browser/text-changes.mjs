/**
 * Notes each text the element with `id` shows, as the page changes it, until the returned function
 * reads the notes, so a test can tell a page that drew once from one that drew twice.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @returns {Promise<() => Promise<string[]>>}
 */
export async function trackTextChanges(page, id) {
  await page.evaluate((elementId) => {
    const element = /** @type {HTMLElement} */ (document.getElementById(elementId));
    const texts = /** @type {string[]} */ ([]);
    let shown = element.textContent;
    new MutationObserver(() => {
      if (element.textContent === shown) return;
      shown = element.textContent;
      texts.push(shown ?? "");
    }).observe(element, { subtree: true, childList: true, characterData: true });
    Object.assign(window, { [`${elementId}Texts`]: texts });
  }, id);
  return () =>
    page.evaluate(
      (elementId) => /** @type {string[]} */ (Reflect.get(window, `${elementId}Texts`)),
      id,
    );
}
