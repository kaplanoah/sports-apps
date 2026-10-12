/**
 * Whether each rank the selector finds, and every part of it, is in the sheet's dim ink, as a rank
 * is wherever it's written beside its number, so no part of it stands out.
 * @param {import("@playwright/test").Locator} scope
 * @param {string} selector
 */
export const checkRanksAreDim = (scope, selector) =>
  scope.locator(selector).evaluateAll((ranks) =>
    ranks.map((rank) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--ink-dim)";
      rank.append(probe);
      const dim = getComputedStyle(probe).color;
      probe.remove();
      return [rank, ...rank.querySelectorAll("*")].every(
        (part) => getComputedStyle(part).color === dim,
      );
    }),
  );
