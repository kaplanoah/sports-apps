/**
 * Keeps the page's requests that match `pattern` from being answered until the returned function
 * is called, or only the first `times` of them.
 * @param {import("@playwright/test").Page} page
 * @param {RegExp} pattern
 * @param {{ times?: number }} [options]
 * @returns {Promise<() => void>}
 */
export async function holdRequests(page, pattern, { times } = {}) {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route(
    pattern,
    async (route) => {
      await held;
      await route.fallback();
    },
    { times },
  );
  return release;
}
