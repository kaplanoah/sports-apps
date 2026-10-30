import { RequestBudgetExhausted } from "./request-budget.js";
import { describeError } from "./responses.js";

// A league's slower feeds, each read again only when it may have changed: as a game ends, for a
// feed that changes with games, or once its answer is older than the feed's own limit. A game's
// end reaches a league's stats a little after its scoreboard, so a feed is read as a game ends
// and once more a few minutes later, and again every few minutes while another feed shows its
// answer is still behind. Each keeps its last good answer to stand in when a read fails, and one
// that didn't answer is asked again every few minutes, however young its kept answer, until one
// answers: not sooner, since a hung read holds up each update until it times out, and meanwhile it
// fails for the same reason its last read did. What it keeps goes in
// `storage`, since a Durable Object leaves memory between updates.

const SETTLE_MS = 10 * 60 * 1000;
export const FAILED_FEED_WAIT_MS = 5 * 60 * 1000;
const BEHIND_FEED_WAIT_MS = 5 * 60 * 1000;
const FINALS_KEY = "finals";

/** @param {{ failedAt: number }} record */
const findRetryAt = (record) => record.failedAt + FAILED_FEED_WAIT_MS;

/**
 * What a keeper keeps its answers in.
 * @typedef {{ get: (key: string) => Promise<any>, put: (key: string, value: any) => Promise<void>, delete: (key: string) => Promise<unknown> }} FeedStorage
 */

/**
 * When a player's numbers were last read, how many games he had then, and, until a read of them
 * answers again, when the last one failed.
 * @typedef {{ games: number, at: number, isSettled: boolean, failedAt?: number }} PlayerRead
 */

/**
 * When a read of a game can no longer miss its last plays. A game the store never saw end was over
 * before it was found final.
 * @param {{ end?: string | null }} game
 */
export const findSettledTime = (game) => (game.end ? Date.parse(game.end) + SETTLE_MS : -Infinity);

/**
 * Whether a player's numbers are due a read: his games changed, or his last read came as he played,
 * before they settled.
 * @param {PlayerRead | undefined} read
 * @param {number} games
 * @param {number} now
 */
export const isPlayerReadDue = (read, games, now) =>
  !read || read.games !== games || (!read.isSettled && now - read.at >= SETTLE_MS);

/** @returns {FeedStorage} */
export function createMemoryStorage() {
  const values = new Map();
  return {
    get: async (key) => values.get(key),
    put: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => values.delete(key),
  };
}

// A request can be longer than a storage key may be, so each is kept under its digest.
/** @param {string} text */
async function digestKey(text) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return [...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Where a keeper keeps a feed's answer to a request.
 * @param {string} name the feed's
 * @param {string} key the request
 */
export const nameFeedKey = (name, key) => digestKey(`${name} ${key}`);

/**
 * @param {object} options
 * @param {Record<string, { maxAgeMs: number, changesWithGames: boolean }>} options.feeds how old
 *   each feed's answer may get, and whether a game's end changes it
 * @param {() => number} options.now
 * @param {FeedStorage} [options.storage]
 */
export function createFeedKeeper({ feeds, now, storage = createMemoryStorage() }) {
  /** @type {Map<string, any>} */
  const records = new Map();
  /** @type {Set<string>} */
  const forgotten = new Set();

  /** @param {string} storageKey */
  async function readRecord(storageKey) {
    if (!records.has(storageKey)) records.set(storageKey, (await storage.get(storageKey)) ?? null);
    return records.get(storageKey);
  }

  // An answer too big to store is still kept until the Durable Object leaves memory.
  /**
   * @param {string} storageKey
   * @param {any} record
   * @param {string} what the record, as an error names it
   */
  async function saveRecord(storageKey, record, what) {
    records.set(storageKey, record);
    try {
      await storage.put(storageKey, record);
    } catch (error) {
      console.error(`Keeping ${what} failed: ${describeError(error)}`);
    }
  }

  /** @param {string} name @param {string} key @param {unknown} error */
  async function rejectFeed(name, key, error) {
    const storageKey = await nameFeedKey(name, key);
    const record = await readRecord(storageKey);
    await saveRecord(
      storageKey,
      {
        failedAt:
          record?.failedAt !== undefined && now() < findRetryAt(record) ? record.failedAt : now(),
        reason: describeError(error),
      },
      `feed ${name}`,
    );
  }

  /**
   * @param {string} name
   * @param {any} record
   * @param {(data: any) => boolean} isBehind
   */
  async function findReadTimes(name, record, isBehind) {
    if (record?.failedAt !== undefined) {
      const retryAt = findRetryAt(record);
      return { dueAt: retryAt, nextReadAt: retryAt };
    }
    const { maxAgeMs, changesWithGames } = feeds[name];
    if (!record?.answer) return { dueAt: -Infinity, nextReadAt: Infinity };
    const { at, data } = record.answer;
    let nextAt = Infinity;
    if (isBehind(data)) nextAt = Math.min(nextAt, at + BEHIND_FEED_WAIT_MS);
    if (changesWithGames) {
      const finals = await readRecord(await digestKey(FINALS_KEY));
      const finalAt = finals?.at ?? -Infinity;
      if (at < finalAt) nextAt = -Infinity;
      else if (at < finalAt + SETTLE_MS) nextAt = Math.min(nextAt, finalAt + SETTLE_MS);
    }
    return { dueAt: Math.min(at + maxAgeMs, nextAt), nextReadAt: nextAt };
  }

  return {
    /**
     * Notes how many games have ended, as the league's scoreboard counts them. A count that
     * couldn't be read is null, and leaves the last one standing.
     * @param {number | null} count
     */
    async noteFinalCount(count) {
      if (count === null) return;
      const finalsKey = await digestKey(FINALS_KEY);
      const finals = await readRecord(finalsKey);
      if (finals?.count === count) return;
      const hasNewFinal = finals !== null && count > finals.count;
      const at = hasNewFinal ? now() : (finals?.at ?? null);
      await saveRecord(finalsKey, { count, at }, FINALS_KEY);
    },

    /**
     * Forgets the answer kept for a request no longer read, once while the keeper is in memory.
     * @param {string} name the feed's
     * @param {string} key the request
     */
    async forgetFeed(name, key) {
      const storageKey = await nameFeedKey(name, key);
      if (forgotten.has(storageKey)) return;
      forgotten.add(storageKey);
      records.delete(storageKey);
      await storage.delete(storageKey);
    },

    rejectFeed,

    /**
     * The feed's kept answer while it's still good, or a new one from `load`.
     * @param {string} name which feed's limit applies
     * @param {string} key the request, so that each season's answers are kept apart
     * @param {() => Promise<any>} load
     * @param {object} [options]
     * @param {boolean} [options.readAgain] read again however young the kept answer, which still
     *   stands in when the read fails
     * @param {(data: any) => boolean} [options.isBehind] whether a kept answer is behind what
     *   another feed already says
     * @param {(reason: string) => void} [options.onFailure] told why the feed's last read failed
     *   while no read since has answered, even when the kept answer stands in
     * @param {(at: number) => void} [options.onNextRead] told when a retry or settling answer needs
     *   an update before the ordinary poll; age alone waits for that poll
     * @param {(data: any) => unknown} [options.validate] checks usable rows for the current consumers
     */
    async readFeed(
      name,
      key,
      load,
      {
        isBehind = () => false,
        readAgain = false,
        onFailure = () => {},
        onNextRead = () => {},
        validate = () => {},
      } = {},
    ) {
      const storageKey = await nameFeedKey(name, key);
      const what = `${name} ${key}`;
      let record = await readRecord(storageKey);
      let answer = record?.answer;
      let hasCheckedAnswer = false;
      async function validateKeptAnswer() {
        if (hasCheckedAnswer || !answer) return;
        hasCheckedAnswer = true;
        try {
          await validate(answer.data);
        } catch (error) {
          answer = undefined;
          await rejectFeed(name, key, error);
        }
      }
      // A due refresh starts before waiting for context needed only by a cached stand-in.
      const scheduledTimes = await findReadTimes(name, record, () => false);
      if (!readAgain && now() < scheduledTimes.dueAt) {
        await validateKeptAnswer();
        record = await readRecord(storageKey);
        const times = await findReadTimes(name, record, isBehind);
        if (now() < times.dueAt) {
          if (record?.reason !== undefined) onFailure(record.reason);
          onNextRead(times.nextReadAt);
          if (answer) return answer.data;
          throw new Error(record.reason);
        }
      }
      try {
        const data = await load();
        await validate(data);
        const updated = { answer: { at: now(), data } };
        await saveRecord(storageKey, updated, what);
        onNextRead((await findReadTimes(name, updated, isBehind)).nextReadAt);
        return data;
      } catch (error) {
        await validateKeptAnswer();
        if (error instanceof RequestBudgetExhausted) {
          if (answer) return answer.data;
          throw error;
        }
        const reason = describeError(error);
        const failed = { answer, failedAt: now(), reason };
        await saveRecord(storageKey, failed, what);
        onFailure(reason);
        onNextRead(findRetryAt(failed));
        if (answer) return answer.data;
        throw error;
      }
    },
  };
}
