// The Worker's health, for an uptime monitor. It answers without the page's key, so the monitor
// holds no secret, and says only whether the Worker and its store answer. It asks the store once a
// minute at most, however often it's hit, so a flood of requests costs the store no more than the
// monitor does. It also says, apart from its own status, what each service it binds answers, as
// often, since a service has no address of its own and the deploy checks it through the apps.
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

/** @typedef {{ ok: boolean, release: string | null }} ServiceHealth */

/**
 * What a service says of itself through its binding, or that it didn't answer.
 * @param {any} binding
 * @returns {Promise<ServiceHealth>}
 */
const askService = (binding) =>
  askInTime(() => binding.readHealth()).then(
    (health) => ({ ok: health?.ok === true, release: health?.release ?? null }),
    () => ({ ok: false, release: null }),
  );

/**
 * @param {object} options
 * @param {(env: any) => Promise<boolean>} options.isStoreAnswering
 * @param {string | null} options.release the commit the Worker was built from
 * @param {string[]} [options.services] the services an app may bind
 * @param {() => number} [options.now]
 */
export function createHealthServer({
  isStoreAnswering,
  release,
  services = SERVICES,
  now = Date.now,
}) {
  const askStore = (env) => askInTime(() => isStoreAnswering(env)).catch(() => false);
  const checkStore = createReusedLoader(askStore, HEALTH_REUSE_MS, now);
  const serviceChecks = services.map((service) => ({
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
    const [isAnswering, serviceHealths] = await Promise.all([checkStore(env), checkServices(env)]);
    const health = {
      ok: isAnswering,
      release,
      store: isAnswering ? "ok" : "no answer",
      ...(Object.keys(serviceHealths).length && { services: serviceHealths }),
    };
    return new Response(JSON.stringify(health), {
      status: isAnswering ? 200 : 503,
      headers: HEALTH_HEADERS,
    });
  };
}
