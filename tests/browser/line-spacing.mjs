import { TABS_GROUP, checkEachView } from "./view-walk.mjs";
import { THEMES, showTheme } from "./theme-layout.mjs";
import { SCREENS } from "./themes.mjs";

/**
 * Every spot in the sheets and settings on screen where a line's spacing breaks sheet.css's
 * rules: a heading under a line sits --heading-below-line below it, and rows of text with a line
 * between them pad --row-line-room on each side of it. It finds the lines, headings, and rows by
 * themselves, so a new one is held to the rules without a list. A row of a set height centers its
 * text in that height instead, and a heading in a card or box, or titling the card under it,
 * answers to the card's edges, not the line.
 * @param {import("@playwright/test").Page} page
 */
const listLineSpacingProblems = (page) => page.evaluate(findLineSpacingProblems);

function findLineSpacingProblems() {
  const TOLERANCE = 0.5;
  const rootStyle = getComputedStyle(document.documentElement);
  const headingBelowLine = parseFloat(rootStyle.getPropertyValue("--heading-below-line"));
  const rowLineRoom = parseFloat(rootStyle.getPropertyValue("--row-line-room"));
  if (!Number.isFinite(headingBelowLine) || !Number.isFinite(rowLineRoom)) {
    return ["--heading-below-line or --row-line-room is not set on :root"];
  }

  /** @param {Element} element */
  const describe = (element) =>
    element.tagName.toLowerCase() + [...element.classList].map((name) => `.${name}`).join("");
  /** @param {Element} element */
  const isShown = (element) =>
    element.checkVisibility({ visibilityProperty: true }) &&
    element.getBoundingClientRect().width > 0;
  /** @param {string} color */
  const isClear = (color) => color === "transparent" || /^rgba\(.*,\s*0\)$|\/\s*0\)$/.test(color);
  /** @param {Element} element */
  const hasSideEdge = (element) => {
    const style = getComputedStyle(element);
    return parseFloat(style.borderLeftWidth) > 0 && style.borderLeftStyle !== "none";
  };

  /**
   * The lines an element draws across its top or bottom, from a border or a 1px inset or outset
   * shadow. A box edged on its sides too, like a card, draws no line between things.
   * @param {Element} element
   */
  function readLines(element) {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    if (box.width < 20 || hasSideEdge(element)) return [];
    const lines = [];
    for (const side of /** @type {const} */ (["top", "bottom"])) {
      const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
      const shown =
        width > 0 &&
        style.getPropertyValue(`border-${side}-style`) !== "none" &&
        !isClear(style.getPropertyValue(`border-${side}-color`));
      if (!shown) continue;
      const top = side === "top" ? box.top : box.bottom - width;
      lines.push({ element, side, top, bottom: top + width, left: box.left, right: box.right });
    }
    const shadows = style.boxShadow === "none" ? [] : style.boxShadow.split(/,(?![^(]*\))/);
    for (const shadow of shadows) {
      const color = shadow.match(/[a-z-]+\([^)]*\)/)?.[0] ?? "";
      if (!color || isClear(color)) continue;
      const [x = 0, y = 0, blur = 0, spread = 0] = (
        shadow.replace(color, "").match(/-?[\d.]+px/g) ?? []
      ).map(parseFloat);
      if (x || !y || blur || spread) continue;
      const inset = shadow.includes("inset");
      const side = inset === y > 0 ? "top" : "bottom";
      const edge = side === "top" ? box.top : box.bottom;
      const top = y > 0 ? edge : edge + y;
      lines.push({
        element,
        side,
        top,
        bottom: top + Math.abs(y),
        left: box.left,
        right: box.right,
      });
    }
    return lines;
  }

  /**
   * What a fan sees in a panel: each run of text and each picture or control.
   * @param {Element} panel
   */
  function readMarks(panel) {
    const marks = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || !isShown(parent)) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width && rect.height) marks.push({ element: parent, rect });
      }
    }
    for (const element of panel.querySelectorAll("svg, img, canvas, input, select, textarea")) {
      if (element.parentElement?.closest("svg") || !isShown(element)) continue;
      marks.push({ element, rect: element.getBoundingClientRect() });
    }
    return marks;
  }

  /**
   * The heading whose text comes first under a line, if what comes first is a heading outside
   * any card or box between it and the panel.
   * @param {{ top: number, bottom: number, left: number, right: number }} line
   * @param {{ element: Element, rect: DOMRect }[]} marks
   * @param {Element} panel
   */
  function findHeadingUnder(line, marks, panel) {
    const under = marks
      .filter(({ rect }) => rect.right > line.left + 1 && rect.left < line.right - 1)
      .filter(({ rect }) => rect.top >= line.bottom - TOLERANCE)
      .sort((first, second) => first.rect.top - second.rect.top)[0];
    const heading = under?.element.closest("h1, h2, h3, h4, h5, h6");
    if (!heading || !panel.contains(heading) || isCardTitle(heading)) return null;
    for (let element = heading; element && element !== panel; element = element.parentElement) {
      if (hasSideEdge(element)) return null;
    }
    return heading;
  }

  /**
   * Whether a heading titles the card right under it, as each of a team's game cards has.
   * @param {Element} heading
   */
  function isCardTitle(heading) {
    const head = heading.parentElement?.childElementCount === 1 ? heading.parentElement : heading;
    const next = head.nextElementSibling;
    return next !== null && hasSideEdge(next);
  }

  /**
   * The row a line belongs to: a table cell's row, or the element itself.
   * @param {Element} element
   */
  const findRow = (element) =>
    element instanceof HTMLTableCellElement ? element.parentElement : element;

  /**
   * Whether two rows are of one kind, as a list's or a table's rows are, rather than groups that
   * each hold their own kind of thing.
   * @param {Element} row
   * @param {Element} other
   */
  const isSameKind = (row, other) =>
    row instanceof HTMLTableRowElement
      ? other instanceof HTMLTableRowElement
      : row.tagName === other.tagName && row.className === other.className;

  /**
   * The row across a line from a row, in the same table or list, if there is one.
   * @param {Element} row
   * @param {"top" | "bottom"} side
   */
  function findRowAcross(row, side) {
    if (row instanceof HTMLTableRowElement) {
      const rows = [...(row.closest("table")?.rows ?? [])].filter(isShown);
      return rows[rows.indexOf(row) + (side === "top" ? -1 : 1)] ?? null;
    }
    let sibling = side === "top" ? row.previousElementSibling : row.nextElementSibling;
    while (sibling && !isShown(sibling)) {
      sibling = side === "top" ? sibling.previousElementSibling : sibling.nextElementSibling;
    }
    return sibling;
  }

  /**
   * Whether a row's height is set rather than its text's, by how its height changes once its
   * height is left to its text.
   * @param {Element} row
   */
  function hasSetHeight(row) {
    const boxes = /** @type {HTMLElement[]} */ ([
      row,
      ...(row instanceof HTMLTableRowElement ? row.cells : []),
    ]);
    const kept = boxes.map((box) => box.getAttribute("style"));
    const before = row.getBoundingClientRect().height;
    for (const box of boxes) {
      box.style.setProperty("height", "auto", "important");
      box.style.setProperty("min-height", "0", "important");
      box.style.setProperty("flex", "none", "important");
      box.style.setProperty("contain", "none", "important");
      box.style.setProperty("container-type", "normal", "important");
    }
    const after = row.getBoundingClientRect().height;
    boxes.forEach((box, index) => {
      const style = kept[index];
      if (style === null) box.removeAttribute("style");
      else box.setAttribute("style", style);
    });
    return Math.abs(before - after) > TOLERANCE;
  }

  /**
   * Whether a cell shows anything for its padding to space from a line.
   * @param {HTMLTableCellElement} cell
   */
  const holdsSomething = (cell) => isShown(cell) && cell.childNodes.length > 0;

  /**
   * The padding a row keeps on one side, from its cells in a table that hold something.
   * @param {Element} row
   * @param {"top" | "bottom"} side
   */
  const readPaddings = (row, side) =>
    (row instanceof HTMLTableRowElement ? [...row.cells].filter(holdsSomething) : [row]).map(
      (box) => parseFloat(getComputedStyle(box).getPropertyValue(`padding-${side}`)),
    );

  /**
   * What's wrong with the room on each side of a line between two rows of text.
   * @param {Element} row
   * @param {"top" | "bottom"} side
   */
  function checkRowLine(row, side) {
    const across = findRowAcross(row, side);
    if (!across || !isSameKind(row, across) || hasSetHeight(row) || hasSetHeight(across)) {
      return [];
    }
    const [upper, lower] = side === "top" ? [across, row] : [row, across];
    const rooms = [...readPaddings(upper, "bottom"), ...readPaddings(lower, "top")];
    return rooms.some((room) => Math.abs(room - rowLineRoom) > TOLERANCE)
      ? [
          `${describe(upper)} | ${describe(lower)}: ${rooms.join(", ")}px by the line, not ${rowLineRoom}px`,
        ]
      : [];
  }

  /**
   * What's wrong with the room between a line and the heading under it.
   * @param {Element} heading
   * @param {{ element: Element, side: string, bottom: number }} line
   */
  function checkHeadingLine(heading, line) {
    const gap = heading.getBoundingClientRect().top - line.bottom;
    return Math.abs(gap - headingBelowLine) > TOLERANCE
      ? [
          `${describe(heading)} sits ${Math.round(gap * 10) / 10}px under ${describe(line.element)}'s ${line.side} line, not ${headingBelowLine}px`,
        ]
      : [];
  }

  const panels = [...document.querySelectorAll(".sheet-page, dialog.settings-panel")].filter(
    isShown,
  );
  if (!panels.length) return ["no sheet or settings shows"];
  return panels.flatMap((panel) => {
    const lines = [...panel.querySelectorAll("*")].filter(isShown).flatMap(readLines);
    const marks = readMarks(panel);
    const problems = new Set();
    for (const line of lines) {
      const heading = findHeadingUnder(line, marks, panel);
      const found = heading
        ? checkHeadingLine(heading, line)
        : checkRowLine(findRow(line.element), line.side);
      for (const problem of found) problems.add(problem);
    }
    return [...problems].map((problem) => `${panel.id || describe(panel)}: ${problem}`);
  });
}

/**
 * Checks every view's sheets and settings with listLineSpacingProblems, in each theme on a phone
 * and a wide screen.
 * @param {import("@playwright/test").TestType<any, any>} test
 * @param {import("@playwright/test").Expect<{}>} expect
 * @param {{
 *   openWithEverything: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   viewGroups: Record<string, import("./view-walk.mjs").View[]>,
 * }} app
 */
export function testLineSpacing(test, expect, app) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  for (const [screen, viewport] of Object.entries(SCREENS)) {
    for (const theme of THEMES) {
      for (const [group, views] of Object.entries(app.viewGroups)) {
        // The tabs space their own lines, like the Games list's held day headings.
        if (group === TABS_GROUP) continue;
        test(`lines in ${group} keep their spacing, ${theme}, on ${screen}`, async ({ page }) => {
          await page.setViewportSize(viewport);
          await app.openWithEverything(page);
          await showTheme(page, theme);
          await checkEachView(page, views, async (view) => {
            expect(await listLineSpacingProblems(page), view.name).toEqual([]);
          });
        });
      }
    }
  }
}
