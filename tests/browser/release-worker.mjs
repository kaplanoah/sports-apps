import { createAppWorker } from "../../shared/worker/app-worker.js";
import { findPageRoot } from "../../worker/apps.mjs";
import { listBundledFiles } from "../../worker/build.mjs";
import { readPageFiles } from "../../worker/page-files.mjs";
import { addTuningPanel } from "../../worker/tuning-files.mjs";
import { TEST_SERVER } from "./harness.mjs";

const APP_KEY = "test-key";
const answerNothing = () => new Response(null, { status: 500 });

/**
 * Page files as the Worker serves them, from an address without the key.
 * @param {ReturnType<typeof listBundledFiles>} pageFiles
 * @returns {(url: URL) => Promise<Response>}
 */
function serveBundledFiles(pageFiles) {
  const worker = createAppWorker({
    pageFiles,
    forwardToStore: answerNothing,
    isStoreAnswering: async () => false,
  });
  return async (url) =>
    worker.fetch(new Request(new URL(`/${APP_KEY}${url.pathname}${url.search}`, url)), {
      APP_KEY,
    });
}

/**
 * The page's files as a deploy of this release serves them.
 * @param {string} app
 * @param {Parameters<typeof listBundledFiles>[1]} release
 */
export const buildReleaseServer = (app, release) =>
  serveBundledFiles(listBundledFiles(app, release));

/**
 * The page's files as a channel serves them while this tuning round is open.
 * @param {string} app
 * @param {import("../../shared/page/tuning-round.js").Round} round
 * @param {string | null} label the channel's, null for production
 */
export function buildTuningServer(app, round, label) {
  const roundFile = { contentType: "application/json", text: JSON.stringify(round) };
  const files = { ...readPageFiles(findPageRoot(app)), "tuning-round.json": roundFile };
  return serveBundledFiles(addTuningPanel(files, label));
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
