import { buildReleaseServer, servePageFiles } from "./release-worker.mjs";
import { test, expect, LOCKED_PAGE_PATH } from "./harness.mjs";

/**
 * @param {string} app
 * @param {(page: import("@playwright/test").Page, options?: { path?: string }) => Promise<unknown>} openApp
 * @param {(page: import("@playwright/test").Page, options: { accessCode: string }) => Promise<unknown>} serveLockedApp
 */
export function checkAppSecurity(app, openApp, serveLockedApp) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("the finished release draws with enforced CSP and permits inline style attributes", async ({
    page,
  }) => {
    await servePageFiles(
      page,
      buildReleaseServer(app, {
        version: "1.0.0",
        commit: "abc1234",
        builtAt: "2026-10-29T12:00:00Z",
        label: null,
      }),
    );
    await openApp(page);
    await expect(page.locator(".view.active")).toBeVisible();
    await expect(page.locator("#loadNote")).toHaveCount(0);
    const color = await page.evaluate(() => {
      const sample = document.createElement("span");
      sample.setAttribute("style", "color: rgb(1, 2, 3)");
      document.body.append(sample);
      const result = getComputedStyle(sample).color;
      sample.remove();
      return result;
    });
    expect(color).toBe("rgb(1, 2, 3)");
  });

  test("the access gate signs in under enforced CSP", async ({ page }) => {
    await serveLockedApp(page, { accessCode: "TESTCODE" });
    await openApp(page, { path: LOCKED_PAGE_PATH });
    await page.locator("input").fill("TESTCODE");
    await page.locator("button[type=submit]").click();
    await expect(page.locator(".view.active")).toBeVisible();
  });

  test("unapproved inline scripts cannot execute", async ({ page, securityViolations }) => {
    await openApp(page);
    await page.evaluate(() => {
      document.documentElement.dataset.securityTest = "blocked";
      const script = document.createElement("script");
      script.textContent = 'document.documentElement.dataset.securityTest = "executed"';
      document.body.append(script);
    });
    await expect.poll(() => securityViolations.length).toBe(1);
    expect(securityViolations.shift()).toBe("CSP violation: script-src-elem inline");
    await expect(page.locator("html")).toHaveAttribute("data-security-test", "blocked");
  });

  test("browser serving preserves methods, origins, agents and conditional requests", async ({
    request,
    baseURL,
  }) => {
    const page = await request.get("/");
    const etag = page.headers()["etag"];
    expect(etag).toBeTruthy();
    const unchanged = await request.get("/", { headers: { "if-none-match": etag } });
    expect(unchanged.status()).toBe(304);
    const refused = await request.post("/styles.css");
    expect(refused.status()).toBe(403);
    const sameOrigin = await request.post("/styles.css", {
      headers: { origin: new URL(baseURL).origin },
      data: "request body",
    });
    expect(sameOrigin.status()).toBe(405);
    const safari = await request.get("/manifest.webmanifest", {
      headers: { "user-agent": "iPhone" },
    });
    expect(await safari.json()).not.toHaveProperty("start_url");
    const chrome = await request.get("/manifest.webmanifest", {
      headers: { "user-agent": "Chrome" },
    });
    expect(await chrome.json()).toHaveProperty("start_url");
  });
}
