// Measures a team sheet's playoff lines and their legend, as each app's team sheet tests check
// them: the legend's spaces between its lines' own text, and how each dashed stretch meets the
// solid one.

/**
 * @param {import("@playwright/test").Locator} sheet
 * @returns {Promise<{ above: number, between: number, below: number, dashes: { meets: number, isGapFirst: boolean }[] }>}
 */
export const measurePlacedLegend = (sheet) =>
  sheet.evaluate((dialog) => {
    const legend = /** @type {HTMLElement} */ (dialog.querySelector(".placed-legend"));
    const numbers = /** @type {HTMLElement} */ (legend.closest(".team-numbers"));
    const rows = numbers.querySelectorAll(".player-rank-row");
    const lastRow = [...rows[rows.length - 1].children].map((cell) => cell.getBoundingClientRect());
    const [first, second] = [...legend.querySelectorAll(".placed-key")].map((key) =>
      key.getBoundingClientRect(),
    );
    const part = /** @type {HTMLElement} */ (legend.closest(".sheet-part"));
    const nextTitle = /** @type {HTMLElement} */ (part.nextElementSibling?.querySelector("h3"));
    const dashes = [...numbers.querySelectorAll(".placed-past")].map((past) => {
      const range = /** @type {HTMLElement} */ (past.parentElement?.querySelector(".placed-range"));
      const pastBox = past.getBoundingClientRect();
      const rangeBox = range.getBoundingClientRect();
      const isTowardStart = past.classList.contains("toward-start");
      const away = isTowardStart ? 270 : 90;
      const pattern = new RegExp(
        `^repeating-linear-gradient\\(${away}deg, rgba\\(0, 0, 0, 0\\) 0px, rgba\\(0, 0, 0, 0\\) 3\\.5px, `,
      );
      return {
        meets: isTowardStart ? rangeBox.left - pastBox.right : pastBox.left - rangeBox.right,
        isGapFirst: pattern.test(getComputedStyle(past).backgroundImage),
      };
    });
    return {
      above: first.top - Math.max(...lastRow.map((cell) => cell.bottom)),
      between: second.top - first.bottom,
      below: nextTitle.getBoundingClientRect().top - second.bottom,
      dashes,
    };
  });
