// Daily visit totals in the app's existing store, without individual events or visitor data.
// Each Worker has its own store, so production and beta totals cannot mix.
import { addDays, readEasternDay } from "../page/days.js";
import { respondJson, respondMethodNotAllowed } from "./responses.js";

const STORAGE_KEY = "visits:daily";
const RETENTION_DAYS = 35;

/**
 * @param {{ storage: any, now: () => number }} options
 */
export function createVisitCounter({ storage, now }) {
  let pending = Promise.resolve();
  let prunedDay = "";

  async function readCurrent() {
    const today = readEasternDay(now()).date;
    const firstDay = addDays(today, 1 - RETENTION_DAYS);
    /** @type {Record<string, Record<string, number>>} */
    const stored = (await storage.get(STORAGE_KEY)) ?? {};
    const days = Object.fromEntries(
      Object.entries(stored).filter(([day]) => day >= firstDay && day <= today),
    );
    return { today, days, isPruned: Object.keys(stored).length !== Object.keys(days).length };
  }

  async function prune() {
    if (prunedDay === readEasternDay(now()).date) return;
    const { today, days, isPruned } = await readCurrent();
    if (isPruned) await storage.put(STORAGE_KEY, days);
    prunedDay = today;
  }

  /** @param {string} host */
  async function record(host) {
    const { today, days } = await readCurrent();
    const counts = (days[today] ??= {});
    counts[host] = (counts[host] ?? 0) + 1;
    await storage.put(STORAGE_KEY, days);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }

  async function read() {
    const { days, isPruned } = await readCurrent();
    if (isPruned) await storage.put(STORAGE_KEY, days);
    return respondJson({ timeZone: "America/New_York", retentionDays: RETENTION_DAYS, days });
  }

  /** @param {() => Promise<any>} operation */
  function serialize(operation) {
    const result = pending.then(operation);
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /** @param {Request} request */
  function serve(request) {
    if (request.method === "GET") return serialize(read);
    if (request.method === "POST") return serialize(() => record(new URL(request.url).hostname));
    return Promise.resolve(respondMethodNotAllowed(["GET", "POST"]));
  }

  return { serve, prune: () => serialize(prune) };
}
