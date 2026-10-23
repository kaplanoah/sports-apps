// Passed straight to evaluate or addInitScript, so it must not close over module values.
export const writeUnreadableLastSeen = () =>
  localStorage.setItem("lastSeen", JSON.stringify({ year: 2026, season: { series: 5 } }));
