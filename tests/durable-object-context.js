// A stand-in for a Durable Object's ctx: its key-value storage, one key or many at a time, its
// alarm, and its accepted WebSockets.
export function createDurableObjectContext() {
  const stored = new Map();
  const sockets = [];
  const alarm = { at: null };
  let transactions = Promise.resolve();
  const ctx = {
    storage: {
      getAlarm: async () => alarm.at,
      setAlarm: async (at) => {
        alarm.at = at;
      },
      get: async (key) => structuredClone(stored.get(key)),
      put: async (keyOrEntries, value) => {
        const entries = typeof keyOrEntries === "string" ? { [keyOrEntries]: value } : keyOrEntries;
        for (const [key, entry] of Object.entries(entries)) stored.set(key, structuredClone(entry));
      },
      delete: async (keyOrKeys) => {
        if (typeof keyOrKeys === "string") return stored.delete(keyOrKeys);
        return keyOrKeys.filter((key) => stored.delete(key)).length;
      },
      list: async ({ prefix = "", limit = undefined, startAfter = "" }) =>
        new Map(
          [...stored]
            .filter(([key]) => key.startsWith(prefix) && key > startAfter)
            .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
            .slice(0, limit),
        ),
      transaction: (callback) => {
        const pending = transactions.then(async () => {
          const changes = new Map();
          const removed = new Set();
          const transaction = {
            get: async (key) =>
              structuredClone(
                removed.has(key)
                  ? undefined
                  : changes.has(key)
                    ? changes.get(key)
                    : stored.get(key),
              ),
            put: async (key, value) => {
              removed.delete(key);
              changes.set(key, structuredClone(value));
            },
            delete: async (key) => {
              changes.delete(key);
              removed.add(key);
              return stored.has(key);
            },
          };
          const result = await callback(transaction);
          for (const key of removed) stored.delete(key);
          for (const [key, value] of changes) stored.set(key, value);
          return result;
        });
        transactions = pending.catch(() => {});
        return pending;
      },
    },
    acceptWebSocket: (socket) => sockets.push(socket),
    getWebSockets: () => sockets,
  };
  return { ctx, stored, sockets, alarm };
}

/**
 * Moves the clock to the store's alarm and fires it, as Cloudflare does at that time.
 * @param {{ alarm: () => Promise<void> }} store
 * @param {ReturnType<typeof createDurableObjectContext>} context
 * @param {{ now: number }} clock
 */
export async function fireNextAlarm(store, context, clock) {
  clock.now = await context.ctx.storage.getAlarm();
  await store.alarm();
}
