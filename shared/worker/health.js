// The Worker's health, for an uptime monitor: whether the Worker and its store answer, and, apart
// from its own status, which of the league's feeds have been failing long enough to need a look,
// and what each service it binds answers, since a service has no address of its own and the deploy
// checks it through the apps. It answers without the page's key, so the monitor
// holds no secret, and asks the store and each service once a minute at most, however often it's
// hit, so a flood of requests costs them no more than the monitor does.
import { listLongFailures } from "./feed-failures.js";
import { SERVICES, nameServiceBinding } from "./services.js";
import { abortAfter } from "./timeout.js";
import { createReusedLoader } from "./upstream.js";

export const HEALTH_REUSE_MS = 60 * 1000;
export const ANSWER_TIMEOUT_MS = 5000;

const HEALTH_HEADERS = {
  "content-type": "application/json",
  "cache-control": `public, max-age=${HEALTH_REUSE_MS / 1000}`,
  "x-robots-tag": "noindex, nofollow",
};

/**
 * Settles as `ask` does, or rejects once `signal` aborts, whichever comes first, since a call to
 * the store ignores the signal.
 * @template Result
 * @param {AbortSignal} signal
 * @param {() => Promise<Result>} ask
 * @returns {Promise<Result>}
 */
const giveUpOnAbort = (signal, ask) =>
  new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    ask().then(resolve, reject);
  });

/**
 * Settles as `ask` does, or rejects once it has taken too long.
 * @template Result
 * @param {() => Promise<Result>} ask
 */
const askInTime = (ask) => abortAfter(ANSWER_TIMEOUT_MS, (signal) => giveUpOnAbort(signal, ask));

// A service that answers can still need its owner, as the email service does for a report waiting
// over an hour or paused, which is no reason to roll back a deploy or call the service down.
/**
 * @typedef {{ ok: boolean, release: string | null, problem?: string, attention?: string }} ServiceHealth
 */

/**
 * @param {any} health what the service answered
 * @returns {ServiceHealth}
 */
function readServiceAnswer(health) {
  const answer = { ok: health?.ok === true, release: health?.release ?? null };
  const note = answer.ok ? "attention" : "problem";
  if (typeof health?.[note] !== "string") return answer;
  return { ...answer, [note]: health[note] };
}

/**
 * What a service says of itself through its binding, or that it didn't answer.
 * @param {any} binding
 * @returns {Promise<ServiceHealth>}
 */
const askService = (binding) =>
  askInTime(() => binding.readHealth()).then(readServiceAnswer, () => ({
    ok: false,
    release: null,
    problem: "it doesn't answer",
  }));

/**
 * @typedef {{ answered: true, feeds: Record<string, import("./feed-failures.js").FeedFailure> } | { answered: false }} StoreHealth
 */

/**
 * @param {object} options
 * @param {(env: any) => Promise<Record<string, import("./feed-failures.js").FeedFailure>>} options.readFeedFailures
 *   which of the league's feeds the store says are failing, throwing when the store doesn't answer
 * @param {string | null} options.release the commit the Worker was built from
 * @param {() => number} [options.now]
 */
export function createHealthServer({ readFeedFailures, release, now = Date.now }) {
  /** @returns {Promise<StoreHealth>} */
  const askStore = (env) =>
    askInTime(() => readFeedFailures(env)).then(
      (feeds) => ({ answered: true, feeds }),
      () => ({ answered: false }),
    );
  const checkStore = createReusedLoader(askStore, HEALTH_REUSE_MS, now);
  const serviceChecks = SERVICES.map((service) => ({
    service,
    binding: nameServiceBinding(service),
    check: createReusedLoader(askService, HEALTH_REUSE_MS, now),
  }));

  // Only the services the Worker binds, so one deployed before a service binds none of them.
  /** @param {any} env */
  async function checkServices(env) {
    const bound = serviceChecks.filter(({ binding }) => env[binding]);
    const healths = await Promise.all(bound.map(({ binding, check }) => check(env[binding])));
    return Object.fromEntries(bound.map(({ service }, index) => [service, healths[index]]));
  }

  /** @param {any} env the Worker's bindings */
  return async function serveHealth(env) {
    const [store, serviceHealths] = await Promise.all([checkStore(env), checkServices(env)]);
    const health = {
      ok: store.answered,
      release,
      store: store.answered ? "ok" : "no answer",
      ...(store.answered && { feeds: listLongFailures(store.feeds, now()) }),
      ...(Object.keys(serviceHealths).length && { services: serviceHealths }),
    };
    return new Response(JSON.stringify(health), {
      status: store.answered ? 200 : 503,
      headers: HEALTH_HEADERS,
    });
  };
}
