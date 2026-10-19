import { isLockedWatchSocket, matchPath, LOCKED_PAGE_PATH } from "./harness.mjs";

// A broken page draws nothing, so a check of one waits only this long rather than a deploy's.
export const BROKEN_CHECK_TIMEOUT_MS = 3000;

/**
 * Answers the locked page's store and its socket as a server that can't be reached.
 * @param {import("@playwright/test").Page} page
 */
export async function serveUnreachableStore(page) {
  await page.route(matchPath(`${LOCKED_PAGE_PATH}store/`), (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.routeWebSocket(isLockedWatchSocket, (socket) => socket.close());
}
