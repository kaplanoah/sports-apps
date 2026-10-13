import { describeError } from "./responses.js";

// A league's slower feeds, each read again only when it may have changed: as a game ends, for a
// feed that changes with games, or once its answer is older than the feed's own limit. A game's
// end reaches a league's stats a little after its scoreboard, so a feed is read as a game ends
// and once more a few minutes later, and again every few minutes while another feed shows its
// answer is still behind. Each keeps its last good answer to stand in when a read fails, and one
// that didn't answer isn't asked again for a while, since a hung read holds up each update until
// it times out. What it keeps goes in `storage`, since a Durable Object leaves memory between
// updates.

const SETTLE_MS = 10 * 60 * 1000;
const FAILED_FEED_WAIT_MS = 5 * 60 * 1000;
const BEHIND_FEED_WAIT_MS = 5 * 60 * 1000;
const FINALS_KEY = "finals";

/**
 * What a keeper keeps its answers in.
 * @typedef {{ get: (key: string) => Promise<any>, put: (key: string, value: any) => Promise<void> }} FeedStorage
 */

/**
 * When a player's numbers were last read, and how many games he had then.
 * @typedef {{ games: number, at: number, isSettled: boolean }} PlayerRead
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
  };
}

// A request can be longer than a storage key may be, so each is kept under its digest.
/** @param {string} key */
async function digestKey(key) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  return [...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {object} options
 * @param {Record<string, { maxAgeMs: number, changesWithGames: boolean }>} options.feeds how old
 *   each feed's answer may get, and whether a game's end changes it
 * @param {string} options.leagueName the league as an error names it, as in "MLB didn't answer"
 * @param {() => number} options.now
 * @param {FeedStorage} [options.storage]
 */
export function createFeedKeeper({ feeds, leagueName, now, storage = createMemoryStorage() }) {
  /** @type {Map<string, any>} */
  const records = new Map();

  /** @param {string} key */
  async function readRecord(key) {
    if (!records.has(key)) records.set(key, (await storage.get(await digestKey(key))) ?? null);
    return records.get(key);
  }

  // An answer too big to store is still kept until the Durable Object leaves memory.
  /**
   * @param {string} key
   * @param {any} record
   */
  async function saveRecord(key, record) {
    records.set(key, record);
    try {
      await storage.put(await digestKey(key), record);
    } catch (error) {
      console.error(`Keeping ${key} failed: ${describeError(error)}`);
    }
  }

  /**
   * @param {number} readAt
   * @param {number} lastFinalAt
   */
  const isReadBeforeFinalSettled = (readAt, lastFinalAt) =>
    readAt < lastFinalAt || (readAt < lastFinalAt + SETTLE_MS && now() >= lastFinalAt + SETTLE_MS);

  /**
   * @param {{ at: number, data: any }} answer
   * @param {(data: any) => boolean} isBehind
   */
  const isBehindLong = (answer, isBehind) =>
    now() - answer.at >= BEHIND_FEED_WAIT_MS && isBehind(answer.data);

  /**
   * @param {string} name
   * @param {any} record
   * @param {(data: any) => boolean} isBehind
   */
  async function isDue(name, record, isBehind) {
    if (record?.failedAt !== undefined && now() - record.failedAt < FAILED_FEED_WAIT_MS)
      return false;
    const { maxAgeMs, changesWithGames } = feeds[name];
    if (!record?.answer || now() - record.answer.at >= maxAgeMs) return true;
    if (isBehindLong(record.answer, isBehind)) return true;
    if (!changesWithGames) return false;
    const finals = await readRecord(FINALS_KEY);
    return isReadBeforeFinalSettled(record.answer.at, finals?.at ?? -Infinity);
  }

  return {
    /**
     * Notes how many games have ended, as the league's scoreboard counts them. A count that
     * couldn't be read is null, and leaves the last one standing.
     * @param {number | null} count
     */
    async noteFinalCount(count) {
      if (count === null) return;
      const finals = await readRecord(FINALS_KEY);
      if (finals?.count === count) return;
      const hasNewFinal = finals !== null && count > finals.count;
      await saveRecord(FINALS_KEY, { count, at: hasNewFinal ? now() : (finals?.at ?? null) });
    },

    /**
     * The feed's kept answer while it's still good, or a new one from `load`.
     * @param {string} name which feed's limit applies
     * @param {string} key the request, so that each season's answers are kept apart
     * @param {() => Promise<any>} load
     * @param {object} [options]
     * @param {(data: any) => boolean} [options.isBehind] whether a kept answer is behind what
     *   another feed already says
     */
    async readFeed(name, key, load, { isBehind = () => false } = {}) {
      const record = await readRecord(`${name} ${key}`);
      const answer = record?.answer;
      if (!(await isDue(name, record, isBehind))) {
        if (answer) return answer.data;
        throw new Error(`${leagueName} didn't answer ${name} a moment ago`);
      }
      try {
        const data = await load();
        await saveRecord(`${name} ${key}`, { answer: { at: now(), data } });
        return data;
      } catch (error) {
        await saveRecord(`${name} ${key}`, { answer, failedAt: now() });
        if (answer) return answer.data;
        throw error;
      }
    },
  };
}
