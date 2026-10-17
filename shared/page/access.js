// A Worker with an access code answers 401 once the phone's code is no longer the one it asks
// for, as when the code changes, and reloading the page shows the Worker's gate. The service
// worker's copy of the page (offline-worker.js) would open in the gate's place, so it goes first,
// with the pictures it kept, while the steps the worker kept stay for Diagnostics.

import { STEPS_CACHE } from "./service-worker.js";

async function forgetPageCopy() {
  try {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name !== STEPS_CACHE).map((name) => caches.delete(name)),
    );
  } catch {
    /* a browser without the cache has no copy */
  }
}

/** @param {Response} response */
export async function reloadWhenSignedOut(response) {
  if (response.status !== 401) return;
  await forgetPageCopy();
  location.reload();
}
