// An app's health says, under feeds, which of its league's feeds have been failing long enough to
// look into, and why, apart from its own status, so a feed that fails never reads as a failing app.
// What it says goes into a public issue, so the Worker's address is masked out of every reason.
import { listAccessCodeMasks, listSiteMasks, maskSecrets } from "./check-page.mjs";
import { CHECK_TIMEOUT_MS } from "./check-timing.mjs";

/** @typedef {import("../shared/worker/feed-failures.js").FeedFailure} FeedFailure */
/**
 * @typedef {{ status: "answering" }
 *   | { status: "failing", feeds: Record<string, FeedFailure> }
 *   | { status: "unchecked", reason: string }} FeedCheck
 */

/**
 * The text with the Worker's address and the access code masked.
 * @param {string} text
 * @param {string} url the app's Worker
 * @param {string} [accessCode]
 */
const hideSecrets = (text, url, accessCode) =>
  maskSecrets(text, [
    ...listSiteMasks(new URL(url), "<worker>"),
    ...listAccessCodeMasks(accessCode),
  ]);

/**
 * The feeds with each reason masked.
 * @param {Record<string, FeedFailure>} feeds
 * @param {string} url
 * @param {string} [accessCode]
 */
const hideFeedSecrets = (feeds, url, accessCode) =>
  Object.fromEntries(
    Object.entries(feeds).map(([feed, failure]) => [
      hideSecrets(feed, url, accessCode),
      {
        since: String(failure.since),
        reason: hideSecrets(String(failure.reason), url, accessCode),
      },
    ]),
  );

/**
 * @param {object} options
 * @param {string} options.url the app's Worker
 * @param {string} [options.accessCode] the code its page asks for, masked out of every reason
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<FeedCheck>}
 */
export async function checkFeeds({ url, accessCode, fetchImpl = fetch }) {
  let feeds;
  try {
    const response = await fetchImpl(new URL("health", url).href, {
      method: "GET",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    feeds = (await response.json())?.feeds;
  } catch {
    return { status: "unchecked", reason: "its health doesn't answer" };
  }
  if (!feeds || typeof feeds !== "object")
    return { status: "unchecked", reason: "its health says nothing of its feeds" };
  if (!Object.keys(feeds).length) return { status: "answering" };
  return { status: "failing", feeds: hideFeedSecrets(feeds, url, accessCode) };
}
