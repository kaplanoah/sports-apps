import { matchPath } from "./harness.mjs";

/** @param {any} test @param {any} expect @param {{ openApp: Function, game: string }} app */
export function testStreamedTabs(test, expect, app) {
  test.use({ serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } });
  for (const source of [
    "notification",
    "games",
    "news",
    "search",
    "dropped",
    "old search",
    "hidden search",
    "missing search",
    "no saved tab",
  ])
    for (const part of ["before the target tab", "after the tab bar", "after the views"])
      test(`${source} chooses its tab in a streamed page paused ${part}`, async ({ page }) => {
        await app.openApp(page);
        const target =
          source === "notification"
            ? "games"
            : ["old search", "hidden search", "missing search"].includes(source)
              ? "news"
              : ["dropped", "no saved tab"].includes(source)
                ? "bracket-standings"
                : source;
        if (["games", "news", "search"].includes(source)) {
          await page.locator(`#tab-${target}`).click();
          if (source === "search") {
            await page.locator("#gameSearch .search-input").fill("playoffs");
            await page.locator("#gameSearch .search-input").press("Enter");
          }
        }
        if (
          ["dropped", "old search", "hidden search", "missing search", "no saved tab"].includes(
            source,
          )
        )
          await page.addInitScript((source) => {
            if (!new URL(location.href).searchParams.has("streamed-test")) return;
            localStorage.removeItem("lastTab");
            localStorage.removeItem("tabBeforeLast");
            if (source === "dropped") localStorage.setItem("lastTab", "removed-tab");
            if (["old search", "hidden search", "missing search"].includes(source)) {
              localStorage.setItem("lastTab", "search");
              localStorage.setItem("tabBeforeLast", "news");
              localStorage.setItem(
                "lastDrawn",
                JSON.stringify({
                  gameSearch:
                    source === "missing search"
                      ? null
                      : {
                          savedAt: source === "hidden search" ? Date.now() : 0,
                          hidden: source === "hidden search",
                        },
                }),
              );
            }
          }, source);
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
                : part === "after the tab bar"
                  ? markup.replace("</nav>", '</nav><script src="test-parser-pause.js"></script>')
                  : markup.replace(
                      '<dialog id="settingsDialog"',
                      '<script src="test-parser-pause.js"></script><dialog id="settingsDialog"',
                    ),
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
            if (["notification", "games", "news", "search"].includes(source))
              await expect(page.locator("nav.tabs [aria-selected=true]")).toHaveCount(0);
          } else {
            await expect(page.locator(`#tab-${target}`)).toBeVisible();
            await expect(page.locator(`#tab-${target}`)).toHaveAttribute("aria-selected", "true");
          }
          if (part === "after the views") {
            await expect(page.locator(`#view-${target}`)).toHaveClass(/\bactive\b/);
            await expect(page.locator("section.view.active")).toHaveCount(1);
          }
        } finally {
          release();
          await loading;
        }
        await expect(page.locator(`#tab-${target}`)).toHaveAttribute("aria-selected", "true");
        if (source === "notification") await expect(page.locator("#gameSheet")).toBeVisible();
      });
}
