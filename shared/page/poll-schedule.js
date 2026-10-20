// How long a league's next update waits, from where its games stand. It runs in both the page and
// the Worker.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const LEAD_MS = 15 * MINUTE_MS;
// Around a game the schedule still moves, as starts are set or put off; far from one it doesn't.
export const GAME_DAY_CHECK_MS = 3 * HOUR_MS;
export const OFF_DAY_CHECK_MS = DAY_MS;

/**
 * The wait for a game past its start that hasn't begun: a delay is closely followed at first, and
 * less as it drags on. The longest on record ran past seven hours, so a game still waiting after
 * eight was put off, or isn't needed and the schedule hasn't dropped it, and is null.
 * @param {number} lateMs
 * @param {number} liveMs
 */
function readLateStartDelay(lateMs, liveMs) {
  if (lateMs < HOUR_MS) return liveMs;
  if (lateMs < 2 * HOUR_MS) return MINUTE_MS;
  if (lateMs < 8 * HOUR_MS) return 5 * MINUTE_MS;
  return null;
}

/**
 * @param {object} games
 * @param {boolean} games.isLive whether a game is under way
 * @param {number[]} games.starts the set starts of the games that haven't begun
 * @param {number[]} [games.putOffStarts] the starts of games the league put off or called off,
 *   which aren't followed as late but keep a day within one of them a game day, since around one
 *   the schedule still moves
 * @param {number} games.liveMs the league's wait during a game
 * @param {number} games.now
 * @returns {number} the wait until the next update
 */
export function choosePollDelay({ isLive, starts, putOffStarts = [], liveMs, now }) {
  if (isLive) return liveMs;
  const knownStarts = starts.filter(Number.isFinite);
  const lateDelays = knownStarts
    .filter((start) => start <= now)
    .map((start) => readLateStartDelay(now - start, liveMs))
    .filter((delay) => delay !== null);
  const nextStart = Math.min(...knownStarts.filter((start) => start > now));
  const isNearPutOff = putOffStarts.some((start) => Math.abs(start - now) < DAY_MS);
  const isGameDay = lateDelays.length > 0 || nextStart - now < DAY_MS || isNearPutOff;
  const untilLead = Math.max(nextStart - LEAD_MS - now, liveMs);
  return Math.min(...lateDelays, untilLead, isGameDay ? GAME_DAY_CHECK_MS : OFF_DAY_CHECK_MS);
}
