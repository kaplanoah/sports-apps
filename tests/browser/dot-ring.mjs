/**
 * Each rank curve dot's ring as the browser draws it, beside the ring it should have: 1.5px of the
 * color of the sheet it sits on.
 * @param {import("@playwright/test").Locator} dots
 */
export const readDotRings = (dots) =>
  dots.evaluateAll((elements) =>
    elements.map((dot) => {
      const sheet = document.createElement("span");
      sheet.style.background = "var(--sheet)";
      dot.after(sheet);
      const expected = `${getComputedStyle(sheet).backgroundColor} 0px 0px 0px 1.5px`;
      sheet.remove();
      return { ring: getComputedStyle(dot).boxShadow, expected };
    }),
  );
