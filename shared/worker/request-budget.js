export class RequestBudgetExhausted extends Error {}

/** @param {typeof fetch} fetchImpl @param {number} limit */
export function createRequestBudget(fetchImpl, limit) {
  let remaining = limit;
  return {
    remaining: () => remaining,
    /** @type {typeof fetch} */
    fetchImpl: (input, init) => {
      if (remaining <= 0) throw new RequestBudgetExhausted("No requests left for history");
      remaining -= 1;
      return fetchImpl(input, init);
    },
  };
}
