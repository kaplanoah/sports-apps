// Counts foreground visits without identifying the browser or keeping anything on the device.
// The existing return watcher also catches Home Screen apps waking without a visibility event.
import { watchTimeAway } from "./resume.js";

const VISIT_AWAY_MS = 30 * 60 * 1000;

/**
 * @param {{ send: () => Promise<unknown>, isVisible: () => boolean }} options
 */
export function createVisitReporter({ send, isVisible }) {
  let hasReported = false;
  return function reportVisit(awayMs = Infinity) {
    if (!isVisible() || (hasReported && awayMs < VISIT_AWAY_MS)) return;
    hasReported = true;
    // Losing an offline visit is preferable to persisting a history of someone's activity.
    Promise.resolve()
      .then(send)
      .catch(() => {});
  };
}

export function startVisits() {
  if (
    navigator.webdriver ||
    navigator.doNotTrack === "1" ||
    navigator["globalPrivacyControl"] === true
  )
    return;
  const reportVisit = createVisitReporter({
    isVisible: () => !document.hidden,
    send: () =>
      fetch(new URL("visits", location.href), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(5000),
      }),
  });
  watchTimeAway(reportVisit);
  document.addEventListener("visibilitychange", () => reportVisit(0));
  reportVisit();
}
