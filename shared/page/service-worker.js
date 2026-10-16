// The page's service worker, sw.js, shows its notifications, keeps its offline copy, and keeps its
// last steps for Diagnostics, which the page reads here.

export const STEPS_CACHE = "service-worker-steps";

/** @type {Promise<ServiceWorkerRegistration> | null} */
let registration = null;

// A registration that failed, as on a weak connection, is tried again the next time it's asked for.
export function registerServiceWorker() {
  registration ??= navigator.serviceWorker.register("sw.js").catch((error) => {
    registration = null;
    throw error;
  });
  return registration;
}

// A browser without service workers, or one that refuses this page's, reads the page from the
// Worker each time.
export function startServiceWorker() {
  if ("serviceWorker" in navigator) registerServiceWorker().catch(() => {});
}

// A worker the phone stops part way never answers, and the page's next release check asks again.
const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Whether the service worker's copy of the page now holds the Worker's page, after it reads it
 * again. A page the worker doesn't control opens from the Worker, which always has it.
 * @returns {Promise<boolean>}
 */
export function refreshPageCopy() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(true);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => resolve(data === true);
    setTimeout(() => resolve(false), REFRESH_TIMEOUT_MS);
    worker.postMessage({ type: "refreshPageCopy" }, [channel.port2]);
  });
}

// The worker writes its steps where the page's own address names them (service-worker-steps.js).
const nameStepsAddress = () => new URL("service-worker-steps", location.href).href;

/**
 * The steps the service worker kept, oldest first, or none on a browser without its caches or
 * where the worker hasn't run.
 * @returns {Promise<import("./step-log.js").StepLine[]>}
 */
export async function readServiceWorkerSteps() {
  try {
    const kept = await caches.match(nameStepsAddress(), { cacheName: STEPS_CACHE });
    const steps = kept ? await kept.json() : [];
    return Array.isArray(steps) ? steps : [];
  } catch {
    return [];
  }
}

/** Forgets the steps the service worker kept so far. */
export async function forgetServiceWorkerSteps() {
  try {
    await caches.delete(STEPS_CACHE);
  } catch {
    /* a browser without the cache has no steps */
  }
}

/**
 * Has the service worker keep these pictures from other sites, and only these, for the page's
 * next load.
 * @param {string[]} urls
 */
export function keepImages(urls) {
  navigator.serviceWorker?.controller?.postMessage({ type: "keepImages", urls });
}
