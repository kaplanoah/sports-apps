export const CHECK_INTERVAL_MS = 5000;
export const CHECK_TIMEOUT_MS = 10000;

/** @param {number} milliseconds */
export const waitFor = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
