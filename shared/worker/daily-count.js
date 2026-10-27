// Takes each device's one count a day (shared/page/daily-count.js) into Workers Analytics Engine,
// as a data point holding only the app's name, so the counts say how many devices opened each app
// a day and nothing about who. Only production binds the dataset, so beta and tests count nothing.
// Nothing reads the counts back through the Worker: only the Cloudflare account can.

import { isWithinTryLimit } from "./access-gate.js";
import { respondError, respondMethodNotAllowed } from "./responses.js";

export const COUNT_PATH = "/count";

/**
 * @param {Request} request
 * @param {any} env
 * @param {string} app the app's name, the one thing a count holds
 */
export async function serveCount(request, env, app) {
  if (request.method !== "POST") return respondMethodNotAllowed(["POST"]);
  if (!(await isWithinTryLimit(request, env, "count")))
    return respondError(429, "too_many_tries", "Too many counts. Try again in a minute.");
  env.DAILY_OPENS?.writeDataPoint({ indexes: [app] });
  return new Response(null, { status: 204 });
}
