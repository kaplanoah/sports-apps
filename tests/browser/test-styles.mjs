import { randomUUID } from "node:crypto";

/** @param {import("@playwright/test").Page} page @param {string} content */
export async function addTestStyles(page, content) {
  const address = new URL(`test-styles-${randomUUID()}.css`, page.url()).href;
  const serveStyles = (route) => route.fulfill({ contentType: "text/css", body: content });
  await page.route(address, serveStyles);
  try {
    return await page.addStyleTag({ url: address });
  } finally {
    await page.unroute(address, serveStyles);
  }
}
