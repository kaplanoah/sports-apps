import { expect } from "./harness.mjs";

/**
 * @param {import("@playwright/test").Page} page
 * @param {(page: import("@playwright/test").Page) => Promise<unknown>} openApp
 */
export async function checkOfflineSecurity(page, openApp) {
  await openApp(page);
  await expect
    .poll(() =>
      page.evaluate(async () => !!(await caches.match(location.href, { cacheName: "page" }))),
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.evaluate(async () => {
    const cache = await caches.open("page");
    const saved = await cache.match(location.href);
    const headers = new Headers(saved.headers);
    headers.delete("content-security-policy");
    await cache.put(location.href, new Response(await saved.text(), { headers }));
  });
  await page.context().setOffline(true);
  const old = await page.reload();
  expect(old.headers()["content-security-policy"]).toBeUndefined();
  await expect(page.locator("#loadNote")).toHaveCount(0);
  await page.context().setOffline(false);
  const updated = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = ({ data }) => resolve(data);
        navigator.serviceWorker.controller.postMessage({ type: "refreshPageCopy" }, [
          channel.port2,
        ]);
      }),
  );
  expect(updated).toBe(true);
  await page.context().setOffline(true);
  const next = await page.reload();
  expect(next.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect(next.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.locator("#loadNote")).toHaveCount(0);
  await expect(page.locator(".view.active")).toBeVisible();
}
