/**
 * Every shown chip (shared/page/chip.css) whose box isn't its look's: a .filled chip's 4.5px beside
 * its words with no border, or an .outlined chip's 3px inside a 1px border, or a chip with neither
 * look or both.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listChipsOffLook = (page) =>
  page.evaluate(() => {
    const LOOKS = {
      filled: { padding: "4.5px", border: "0px" },
      outlined: { padding: "3px", border: "1px" },
    };

    /** @param {Element} chip */
    const describeBox = (chip) => {
      const style = getComputedStyle(chip);
      const sides = /** @type {const} */ (["Top", "Right", "Bottom", "Left"]);
      return {
        padding: [style.paddingLeft, style.paddingRight],
        border: sides.map((side) => style.getPropertyValue(`border-${side.toLowerCase()}-width`)),
      };
    };

    /** @param {Element} chip */
    const listProblems = (chip) => {
      const looks = Object.entries(LOOKS).filter(([look]) => chip.classList.contains(look));
      if (looks.length !== 1) return ["not one look"];
      const [[look, expected]] = looks;
      const { padding, border } = describeBox(chip);
      return [
        padding.some((side) => side !== expected.padding)
          ? `${look} with ${padding.join(" and ")} beside its words`
          : "",
        border.some((side) => side !== expected.border)
          ? `${look} in a ${border.join(" ")} border`
          : "",
      ].filter(Boolean);
    };

    return [...document.querySelectorAll(".chip")]
      .filter((chip) => chip.checkVisibility())
      .flatMap((chip) => {
        const problems = listProblems(chip);
        return problems.length
          ? [`${chip.getAttribute("class")} "${chip.textContent?.trim()}": ${problems.join(", ")}`]
          : [];
      });
  });

/**
 * The looks of every shown chip, so a test of them knows it saw each.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listShownChipLooks = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".chip")]
      .filter((chip) => chip.checkVisibility())
      .flatMap((chip) => ["filled", "outlined"].filter((look) => chip.classList.contains(look))),
  );
