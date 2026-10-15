import { createStepLog, nameFile } from "./step-log.js";

// Each error the page's code throws and nothing catches, and each promise it lets fail, with where
// it came from, since a phone shows the page's errors nowhere.
export const errorLog = createStepLog({
  key: "diagnosticsErrors",
  title: "Errors",
  isWatched: () => false,
});

/**
 * @param {ErrorEvent} event
 * @returns {string}
 */
export function describeError({ message, filename, lineno, colno }) {
  const where = filename ? ` at ${nameFile(filename)}:${lineno}:${colno}` : "";
  return `${message}${where}`;
}

/**
 * @param {PromiseRejectionEvent} event
 * @returns {string}
 */
export function describeRejection({ reason }) {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  return `a promise failed: ${text}`;
}

/** Logs each error the page doesn't catch, while Diagnostics is on. */
export function watchErrors() {
  addEventListener("error", (event) => errorLog.noteStep(describeError(event)));
  addEventListener("unhandledrejection", (event) => errorLog.noteStep(describeRejection(event)));
}
