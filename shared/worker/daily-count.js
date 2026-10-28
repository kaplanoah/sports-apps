// Takes each browser's or Home Screen app's one count a day (shared/page/daily-count.js) into
// Workers Analytics Engine, as a data point holding the app's name and the address it was opened
// at, so the counts say how many opened each app a day at each of its addresses, and nothing about
// who. Only production binds the dataset, so beta and tests count nothing. Nothing reads the
// counts back through the Worker: only the Cloudflare account can.

import { COUNT_ROUTE } from "../page/count-path.js";
import { isWithinTryLimit } from "./access-gate.js";
import { respondError, respondMethodNotAllowed } from "./responses.js";

export const COUNT_PATH = `/${COUNT_ROUTE}`;

/**
 * @param {Request} request
 * @param {any} env
 * @param {string} app the app's name, which a count holds beside the request's hostname
 */
export async function serveCount(request, env, app) {
  if (request.method !== "POST") return respondMethodNotAllowed(["POST"]);
  if (!(await isWithinTryLimit(request, env, "count")))
    return respondError(429, "too_many_tries", "Too many counts. Try again in a minute.");
  const { hostname } = new URL(request.url);
  env.DAILY_OPENS?.writeDataPoint({ indexes: [app], blobs: [hostname] });
  return new Response(null, { status: 204 });
}
