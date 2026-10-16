/**
 * The space after each letter of the app's name but its last, in ems of the title's size: where
 * each letter lands, against where it lands with every letter at the title's own spacing, so a
 * test checks the gaps a fan sees in any font, monospaced or not. Each is rounded to a step of
 * 0.005em, past the 64ths of a pixel the page lays letters out in.
 * @param {import("@playwright/test").Page} page
 */
export const readTitleGaps = (page) =>
  page.locator("header.top h1").evaluate((title) => {
    const style = getComputedStyle(title);
    const size = parseFloat(style.fontSize);
    const tracking = parseFloat(style.letterSpacing) / size;
    const letters = [...title.querySelectorAll(".title-letter")].map((letter) => letter.firstChild);
    const last = [...title.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    const range = document.createRange();
    const readLefts = () =>
      [...letters, last].map((node) => {
        const offset = node.textContent.search(/\S/);
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        return range.getBoundingClientRect().left;
      });
    const kerned = readLefts();
    const even = document.createElement("style");
    even.textContent = "header.top h1 .title-letter { margin: 0 !important; }";
    document.head.append(even);
    const unkerned = readLefts();
    even.remove();
    const shifts = kerned.map((left, index) => left - unkerned[index]);
    const STEP = 0.005;
    return shifts
      .slice(1)
      .map((shift, index) => tracking + (shift - shifts[index]) / size)
      .map((gap) => Number((Math.round(gap / STEP) * STEP).toFixed(3)));
  });
