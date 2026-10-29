export function createRateClock() {
  let time = 0;
  const timers = new Set();
  return {
    now: () => time,
    wait(ms, signal) {
      return new Promise((resolve, reject) => {
        const timer = { at: time + ms, resolve };
        timers.add(timer);
        signal?.addEventListener(
          "abort",
          () => {
            timers.delete(timer);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    },
    async advance(to) {
      time = to;
      for (const timer of [...timers]) {
        if (timer.at <= time) {
          timers.delete(timer);
          timer.resolve();
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
