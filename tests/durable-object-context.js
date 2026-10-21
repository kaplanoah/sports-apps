// A stand-in for a Durable Object's ctx: its key-value storage, one key or many at a time, its
// alarm, and its accepted WebSockets.
export function createDurableObjectContext() {
  const stored = new Map();
  const sockets = [];
  const alarm = { at: null };
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
      list: async ({ prefix, limit }) =>
        new Map(
          [...stored]
            .filter(([key]) => key.startsWith(prefix))
            .sort(([first], [second]) => first.localeCompare(second))
            .slice(0, limit),
        ),
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
