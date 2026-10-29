import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

/** @param {string} value */
export function readProcessLifetime(value) {
  const end = value.lastIndexOf(")");
  const fields = value
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const pid = Number(value.slice(0, value.indexOf(" ")));
  const start = fields[19];
  if (end < 0 || !Number.isSafeInteger(pid) || pid <= 1 || !/^\d+$/.test(start ?? "") || !fields[0])
    throw new Error("Invalid native parent lifetime.");
  return { pid, start, state: fields[0] };
}

/** @param {number} pid @param {(path:string)=>string} [read] */
export function inspectProcessLifetime(pid, read = (path) => readFileSync(path, "utf8")) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid native parent PID.");
  try {
    return readProcessLifetime(read(`/proc/${pid}/stat`));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ESRCH"].includes(String(error.code))
    )
      return null;
    throw error;
  }
}

/** @param {any} options */
export async function monitorNativeLifetime({
  parent,
  deadline,
  stop,
  finalize,
  inspect = inspectProcessLifetime,
  now = Date.now,
  wait = delay,
}) {
  if (
    !parent ||
    !Number.isSafeInteger(parent.pid) ||
    parent.pid <= 1 ||
    !/^\d+$/.test(parent.start ?? "") ||
    !Number.isSafeInteger(deadline) ||
    deadline <= now()
  )
    throw new Error("Invalid native limiter lifetime.");
  let termination = "deadline";
  try {
    for (;;) {
      const current = inspect(parent.pid);
      if (!current || current.start !== parent.start || ["Z", "X"].includes(current.state)) {
        termination = "parent-exited";
        break;
      }
      if (now() >= deadline) break;
      await wait(Math.min(100, Math.max(1, deadline - now())));
    }
  } finally {
    await stop();
  }
  await finalize({ termination, completedAt: now() });
  return termination;
}
