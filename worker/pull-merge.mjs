// GitHub computes a pull request's mergeability after the event that changed it.
import { waitFor } from "./check-timing.mjs";

const MERGEABLE_TRIES = 6;
const MERGEABLE_WAIT_MS = 5000;

/**
 * @param {(path: string) => Promise<any>} readPull
 * @param {number | string} number
 * @param {{ isReady?: (pull: any) => boolean, wait?: (ms: number) => Promise<unknown> }} [options]
 */
export async function readPullMerge(
  readPull,
  number,
  { isReady = (pull) => pull.mergeable !== null, wait = waitFor } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    const pull = await readPull(`/pulls/${number}`);
    if (isReady(pull) || attempt === MERGEABLE_TRIES) return pull;
    await wait(MERGEABLE_WAIT_MS);
  }
}
