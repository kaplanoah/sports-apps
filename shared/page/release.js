// A release's label names its channel, like beta, and is null on production.
/** @typedef {{ version: string | null, commit: string, builtAt: string | null, label: string | null }} Release */

// A phone waking a page can hold its first requests until they time out, so a read gives up
// rather than keep every later check waiting on it.
const RELEASE_TIMEOUT_MS = 10 * 1000;

/** @type {Promise<Release | null> | null} */
let loadedRelease = null;

// The deploy writes version.json into the Worker's bundle; a local server has none, and answers
// null. A read that gets no answer rejects, so a caller can try again.
/**
 * @param {URL} url
 * @returns {Promise<Release | null>}
 */
async function readRelease(url) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`version.json answered ${response.status}`);
  return response.json();
}

export const fetchRelease = () => readRelease(new URL("version.json", location.href));

// The release this page's files came from, read from their own folder, since the Worker may
// already serve a newer one, and a server still on another release has no such folder. A read
// that found nothing isn't kept, so the next check tries again.
export function loadRelease() {
  loadedRelease ??= readRelease(new URL("../version.json", import.meta.url)).then(
    (release) => {
      if (!release) loadedRelease = null;
      return release;
    },
    (error) => {
      loadedRelease = null;
      throw error;
    },
  );
  return loadedRelease;
}
