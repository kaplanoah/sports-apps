import { matchPath } from "./harness.mjs";

/** @param {any} test @param {any} expect @param {{ openApp: Function, game: string }} app */
export function testStreamedTabs(test, expect, app) {
  test.use({ serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } });
  for (const source of ["notification", "games", "news", "search"])
    for (const part of ["before the target tab", "after the tab bar"])
      test(`${source} chooses its tab in a streamed page paused ${part}`, async ({ page }) => {
        await app.openApp(page);
        const target = source === "notification" ? "games" : source;
        if (source !== "notification") {
          await page.locator(`#tab-${target}`).click();
          if (source === "search") {
            await page.locator("#gameSearch .search-input").fill("playoffs");
            await page.locator("#gameSearch .search-input").press("Enter");
          }
        }
        const url = new URL(page.url());
        const markup = await (await page.request.get(url.href)).text();
        url.searchParams.set("streamed-test", "1");
        if (source === "notification") {
          url.searchParams.set("game", app.game);
          url.searchParams.set("season", "2026");
        }
        const targetButton = new RegExp(`<button\\b[^>]*\\bid="tab-${target}"`);
        await page.route("**/?streamed-test=**", (route) =>
          route.fulfill({
            contentType: "text/html",
            body:
              part === "before the target tab"
                ? markup.replace(targetButton, '<script src="test-parser-pause.js"></script>$&')
                : markup.replace("</nav>", '</nav><script src="test-parser-pause.js"></script>'),
          }),
        );
        let release = () => {};
        const held = new Promise((resolve) => {
          release = () => resolve(undefined);
        });
        await page.route(matchPath("/test-parser-pause.js"), async (route) => {
          await held;
          await route.fulfill({ contentType: "text/javascript", body: "" });
        });
        const paused = page.waitForRequest(matchPath("/test-parser-pause.js"));
        const loading = page.goto(url.href, { waitUntil: "domcontentloaded" });
        try {
          await paused;
          if (part === "before the target tab") {
            await expect(page.locator(`#tab-${target}`)).toHaveCount(0);
            await expect(page.locator("nav.tabs [aria-selected=true]")).toHaveCount(0);
          } else {
            await expect(page.locator(`#tab-${target}`)).toBeVisible();
            await expect(page.locator(`#tab-${target}`)).toHaveAttribute("aria-selected", "true");
          }
        } finally {
          release();
          await loading;
        }
        await expect(page.locator(`#tab-${target}`)).toHaveAttribute("aria-selected", "true");
        if (source === "notification") await expect(page.locator("#gameSheet")).toBeVisible();
      });
}
