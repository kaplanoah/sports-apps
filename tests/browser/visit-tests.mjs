import { passTime, setHidden } from "./visibility.mjs";

/** @param {{ test: any, expect: any, openApp: any, matchPath: any }} harness */
export function defineVisitTests({ test, expect, openApp, matchPath }) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("foreground openings count without payloads, referrers, or background polling", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "doNotTrack", { get: () => null });
    });
    const visits = [];
    await page.route(matchPath("/visits"), async (route) => {
      const request = route.request();
      visits.push({
        method: request.method(),
        body: request.postData(),
        referrer: request.headers().referer,
      });
      await route.fulfill({ status: 204 });
    });
    await openApp(page);
    await expect.poll(() => visits.length).toBe(1);
    expect(visits[0]).toEqual({ method: "POST", body: null, referrer: undefined });
    await page.clock.runFor(60 * 1000);
    await setHidden(page, true);
    await passTime(page, 29 * 60 * 1000);
    await setHidden(page, false);
    await page.clock.runFor(1000);
    expect(visits).toHaveLength(1);
    await setHidden(page, true);
    await passTime(page, 30 * 60 * 1000);
    await setHidden(page, false);
    await expect.poll(() => visits.length).toBe(2);
  });

  test("automated browser checks never report visits", async ({ page }) => {
    let visits = 0;
    await page.route(matchPath("/visits"), async (route) => {
      visits += 1;
      await route.fulfill({ status: 204 });
    });
    await openApp(page);
    await page.clock.runFor(60 * 1000);
    await setHidden(page, true);
    await passTime(page, 31 * 60 * 1000);
    await setHidden(page, false);
    await page.clock.runFor(1000);
    expect(visits).toBe(0);
  });

  test("a page loaded in a hidden tab counts only once it first becomes visible", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "doNotTrack", { get: () => null });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    });
    let visits = 0;
    await page.route(matchPath("/visits"), async (route) => {
      visits += 1;
      await route.fulfill({ status: 204 });
    });
    await openApp(page);
    expect(visits).toBe(0);
    await setHidden(page, false);
    await expect.poll(() => visits).toBe(1);
    await setHidden(page, true);
    await setHidden(page, false);
    await page.clock.runFor(1000);
    expect(visits).toBe(1);
  });
}
