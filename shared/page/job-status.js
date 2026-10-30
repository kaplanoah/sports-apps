// Job status types shared with Diagnostics without importing Worker persistence.
/**
 * @typedef {{ at: string, message: string }} JobFailure
 */

/**
 * @typedef {object} JobRunStatus
 * @property {string} ranAt
 * @property {number} durationMs
 * @property {number} requests
 * @property {JobFailure | null} lastFailure
 */

export {};
