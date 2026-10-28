/**
 * Keeps the page's requests that match `pattern` from being answered until the returned function
 * is called, or only the first `times` of them, then lets each through, or answers it with `answer`.
 * @param {import("@playwright/test").Page} page
 * @param {RegExp} pattern
 * @param {{ times?: number, answer?: (route: import("@playwright/test").Route) => Promise<void> }} [options]
 * @returns {Promise<() => void>}
 */
export async function holdRequests(
  page,
  pattern,
  { times, answer = (route) => route.fallback() } = {},
) {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route(
    pattern,
    async (route) => {
      await held;
      await answer(route);
    },
    { times },
  );
  return release;
}
