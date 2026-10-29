import { createMemoryStorage } from "../../../../shared/worker/feed-keeper.js";
import { describeError } from "../../../../shared/worker/responses.js";

// ESPN's backup is read only while the league's scoreboard falls short, so a backup that broke
// while the scoreboard answered would go unseen until the day it's needed. So while it isn't
// needed, it's still read about once an hour, and a failed read again after a few minutes, and
// why it last failed stands until the next read, in `storage`, since a Durable Object leaves
// memory between updates. Its first read waits a probe's time, so a Worker that just started
// reads nothing more than it needs.

const BACKUP_PROBE_MS = 60 * 60 * 1000;
const BACKUP_RETRY_MS = 5 * 60 * 1000;
const STORAGE_KEY = "backup-probe";

/**
 * @typedef {{ days: string[], answers: any[], missed: { day: string, error: unknown }[] }} Backup
 */

/**
 * Why a backup that answered left out a day, or null when it left out none.
 * @param {Backup} backup
 */
const describeMissedDay = ({ missed }) =>
  missed.length
    ? `ESPN didn't answer for ${missed[0].day}: ${describeError(missed[0].error)}`
    : null;

/**
 * The backup and why its read fell short, or null for none.
 * @param {() => Promise<Backup>} fetchBackup
 * @returns {Promise<{ backup: Backup | null, failure: string | null }>}
 */
async function fetchBackupOrFailure(fetchBackup) {
  try {
    const backup = await fetchBackup();
    return { backup, failure: describeMissedDay(backup) };
  } catch (error) {
    return { backup: null, failure: describeError(error) };
  }
}

/**
 * @param {{ at: number, failure: string | null }} probe
 * @param {number} now
 */
const isProbeDue = (probe, now) =>
  now - probe.at >= (probe.failure === null ? BACKUP_PROBE_MS : BACKUP_RETRY_MS);

/**
 * @param {object} options
 * @param {() => Promise<Backup>} options.fetchBackup
 * @param {() => number} options.now
 * @param {import("../../../../shared/worker/feed-keeper.js").FeedStorage} [options.storage]
 */
export function createBackupReader({ fetchBackup, now, storage = createMemoryStorage() }) {
  /** The last probe, or a first one that only marks when the probes start. */
  async function readProbe() {
    const probe = await storage.get(STORAGE_KEY);
    if (probe) return probe;
    const first = { at: now(), failure: null };
    await storage.put(STORAGE_KEY, first);
    return first;
  }

  /**
   * The backup while it's needed, and why the backup last failed, or null while it answers.
   * @param {boolean} isNeeded
   */
  return async function readBackup(isNeeded) {
    if (!isNeeded) {
      const probe = await readProbe();
      if (!isProbeDue(probe, now())) return { backup: null, failure: probe.failure };
    }
    const { backup, failure } = await fetchBackupOrFailure(fetchBackup);
    await storage.put(STORAGE_KEY, { at: now(), failure });
    return { backup: isNeeded ? backup : null, failure };
  };
}
