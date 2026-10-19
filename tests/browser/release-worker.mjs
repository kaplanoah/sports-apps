import { createAppWorker } from "../../shared/worker/app-worker.js";
import { listBundledFiles } from "../../worker/build.mjs";
import { TEST_SERVER } from "./harness.mjs";

const APP_KEY = "test-key";
const answerNothing = () => new Response(null, { status: 500 });

/**
 * The page's files as a deploy of this release serves them, from an address without the key.
 * @param {string} app
 * @param {Parameters<typeof listBundledFiles>[1]} release
 * @returns {(url: URL) => Promise<Response>}
 */
export function buildReleaseServer(app, release) {
  const worker = createAppWorker({
    pageFiles: listBundledFiles(app, release),
    forwardToStore: answerNothing,
    isStoreAnswering: async () => false,
  });
  return async (url) =>
    worker.fetch(new Request(new URL(`/${APP_KEY}${url.pathname}${url.search}`, url)), {
      APP_KEY,
    });
}

/**
 * Answers the page's files from a release server, under any routes the test adds after.
 * @param {import("@playwright/test").Page} page
 * @param {(url: URL) => Promise<Response>} serve
 */
export async function servePageFiles(page, serve) {
  await page.route(TEST_SERVER, async (route) => {
    const answer = await serve(new URL(route.request().url()));
    await route.fulfill({
      status: answer.status,
      headers: Object.fromEntries(answer.headers),
      body: Buffer.from(await answer.arrayBuffer()),
    });
  });
}
