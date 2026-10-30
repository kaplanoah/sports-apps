// Forty leaves headroom below the free plan's 50 subrequests per invocation, including redirects.
export const ALARM_REQUEST_ALLOWANCE = 40;
export const HISTORY_REQUESTS_PER_RUN = 4;

export class RequestBudgetExhausted extends Error {}

/** @param {typeof fetch} fetchImpl @param {number} limit @param {() => boolean} [isActive] */
export function createRequestBudget(fetchImpl, limit, isActive = () => true) {
  let remaining = limit;
  return {
    remaining: () => (isActive() ? remaining : 0),
    /** @type {typeof fetch} */
    fetchImpl: (input, init) => {
      if (!isActive() || remaining <= 0)
        throw new RequestBudgetExhausted("No requests left for history");
      remaining -= 1;
      return fetchImpl(input, init);
    },
  };
}
