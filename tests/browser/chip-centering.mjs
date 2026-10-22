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
     * A box set inline after a chip's words, with no width, whose bottom is on their baseline.
     * @param {string} height
     */
    const createProbe = (height) => {
      const probe = document.createElement("span");
      probe.style.cssText = `display: inline-block; width: 0; height: ${height}`;
      return probe;
    };

    /**
     * Where the chip's box, baseline, and capitals are drawn. The baseline is the top of a probe
     * with no height, and the capitals as tall as a probe 1cap tall, which text-box trims the
     * words to.
     * @param {{ chip: Element, baselineProbe: Element, capitalsProbe: Element }} probed
     */
    const measureChip = ({ chip, baselineProbe, capitalsProbe }) => {
      const style = getComputedStyle(chip);
      const box = chip.getBoundingClientRect();
      const baseline = baselineProbe.getBoundingClientRect().top;
      const capitals = capitalsProbe.getBoundingClientRect().height;
      return {
        chip,
        top: box.top,
        insideMiddle:
          (box.top +
            parseFloat(style.borderTopWidth) +
            box.bottom -
            parseFloat(style.borderBottomWidth)) /
          2,
        baseline,
        capitalsMiddle: baseline - capitals / 2,
      };
    };

    /** @param {ReturnType<typeof measureChip>} measured */
    const listProblems = ({ top, insideMiddle, baseline, capitalsMiddle }) => {
      const offMiddle = capitalsMiddle - insideMiddle;
      const baselineFromTop = baseline - top;
      const offWhole = baselineFromTop - Math.round(baselineFromTop);
      return [
        Math.abs(offMiddle) > MOST_OFF_PX ? `capitals ${round(offMiddle)}px off its middle` : "",
        Math.abs(offWhole) > MOST_OFF_PX
          ? `baseline ${round(baselineFromTop)}px from its top, off a whole pixel`
          : "",
      ].filter(Boolean);
    };

    // Every probe goes in before any is read, so the page lays out once rather than once a chip.
    const probed = [...document.querySelectorAll(".chip")]
      .filter((chip) => chip.checkVisibility())
      .map((chip) => {
        const baselineProbe = createProbe("0");
        const capitalsProbe = createProbe("1cap");
        chip.append(baselineProbe, capitalsProbe);
        return { chip, baselineProbe, capitalsProbe };
      });
    const measured = probed.map(measureChip);
    for (const { baselineProbe, capitalsProbe } of probed) {
      baselineProbe.remove();
      capitalsProbe.remove();
    }

    return measured.flatMap((each) => {
      const problems = listProblems(each);
      return problems.length
        ? [
            `${each.chip.getAttribute("class")} "${each.chip.textContent?.trim()}": ${problems.join(", ")}`,
          ]
        : [];
    });
  });
