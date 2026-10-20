/**
 * Every shown chip (shared/page/chip.css) whose words a screen would draw off its middle: its
 * capitals' middle more than 0.1px off the middle of the room inside its borders, or its baseline
 * more than 0.1px off a whole pixel from its top, which a screen snaps a pixel up or down.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listChipsOffCenter = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const MOST_OFF_PX = 0.1;
    /** @param {number} value */
    const round = (value) => Math.round(value * 100) / 100;

    /**
     * Where the chip's baseline and capitals are drawn, from a zero-size box set inline after its
     * words, whose top is on their baseline, and one as tall as their capitals, which text-box
     * trims the words to.
     * @param {Element} chip
     */
    const readWords = (chip) => {
      const baselineProbe = document.createElement("span");
      baselineProbe.style.cssText = "display: inline-block; width: 0; height: 0";
      const capitalsProbe = document.createElement("span");
      capitalsProbe.style.cssText = "display: inline-block; width: 0; height: 1cap";
      chip.append(baselineProbe, capitalsProbe);
      const baseline = baselineProbe.getBoundingClientRect().top;
      const capitals = capitalsProbe.getBoundingClientRect().height;
      baselineProbe.remove();
      capitalsProbe.remove();
      return { baseline, capitalsMiddle: baseline - capitals / 2 };
    };

    /** @param {Element} chip */
    const listProblems = (chip) => {
      const style = getComputedStyle(chip);
      const box = chip.getBoundingClientRect();
      const insideMiddle =
        (box.top +
          parseFloat(style.borderTopWidth) +
          box.bottom -
          parseFloat(style.borderBottomWidth)) /
        2;
      const { baseline, capitalsMiddle } = readWords(chip);
      const offMiddle = capitalsMiddle - insideMiddle;
      const baselineFromTop = baseline - box.top;
      const offWhole = baselineFromTop - Math.round(baselineFromTop);
      return [
        Math.abs(offMiddle) > MOST_OFF_PX ? `capitals ${round(offMiddle)}px off its middle` : "",
        Math.abs(offWhole) > MOST_OFF_PX
          ? `baseline ${round(baselineFromTop)}px from its top, off a whole pixel`
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
