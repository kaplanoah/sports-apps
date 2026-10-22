// Beta's own Worker answers its previews through this entrypoint, which only a binding reaches, so
// a preview, which holds no secret or store, runs on beta's key, code, and store
// (servePreview in app-worker.js).

import { WorkerEntrypoint } from "#workers-runtime";

/** @param {ReturnType<typeof import("./app-worker.js").createAppWorker>} worker */
export function createPreviewEntrypoint(worker) {
  return class PreviewEntrypoint extends WorkerEntrypoint {
    /** @param {Request} request */
    fetch(request) {
      return worker.fetch(request, this.env);
    }

    /**
     * @param {string} address
     * @param {string | null} cookie
     */
    readPageRoute(address, cookie) {
      return worker.readPageRoute(address, cookie, this.env);
    }
  };
}
