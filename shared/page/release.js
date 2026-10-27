// A release's label names its channel, like beta, and is null on production.
/** @typedef {{ version: string | null, commit: string, builtAt: string, label: string | null }} Release */

// A phone waking a page can hold its first requests until they time out, so a request made as the
// page wakes gives up rather than keep every later try waiting on it.
export const WAKING_REQUEST_TIMEOUT_MS = 10 * 1000;

// The deploy writes version.json into the Worker's bundle; a local server has none, and answers
// null. A read that gets no answer rejects, so a caller can try again.
/** @returns {Promise<Release | null>} */
export async function fetchRelease() {
  const response = await fetch(new URL("version.json", location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(WAKING_REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`version.json answered ${response.status}`);
  return response.json();
}

// The release this page came from, which the build writes into it (`writeRelease` in the root's
// worker/page-files.mjs), so the page knows it at once, offline too, and however long the Worker
// has served a newer one. A local server's page has none.
/** @returns {Release | null} */
export function readPageRelease() {
  const written = document.getElementById("release")?.textContent;
  return written ? JSON.parse(written) : null;
}
