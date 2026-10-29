import { readCapitals } from "./capitals.mjs";

/** @typedef {"small" | "team" | "large" | "label"} TeamRole */

/**
 * Independent expected geometry supplied by an app's tests.
 * @typedef {object} TeamLineExpectations
 * @property {{ selector: string, name: string }} lines
 * @property {string[]} placeholders
 * @property {Record<TeamRole, { font: string, size: number, weight: number, diameter: number, before: number, after: number }>} roles
 * @property {{ selector: string, role: TeamRole }[]} roleSelectors in priority order
 * @property {{ selector: string, delta: number }[]} weightChanges
 * @property {{ selector: string, state: string }[]} stateSelectors
 * @property {{ selector: string, name: string, note: string }[]} baselines
 * @property {{ width: number, offset: number }} allStar
 * @property {Partial<Record<TeamRole, { before: number, after: number }>>} seeds
 * @property {{ name: string, parents: string[], selector: string, center: "capital" | "lowercase", offset: number, gridAreas?: string }[]} attachments
 */

/**
 * Real team-line geometry, measured against the loaded font's cap and x heights.
 * @param {import("@playwright/test").Page} page
 * @param {TeamLineExpectations} expectations
 */
export const readTeamLines = async (page, expectations) => {
  const drawn = await page.evaluate(async (expected) => {
    await document.fonts.ready;
    const problems = [];
    const roles = new Set();
    const placements = new Set();
    const states = new Set();
    const names = new Set();
    const attachments = new Set();
    const findMiddle = (element) => {
      const box = element.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const check = (actual, expected, description) => {
      if (Math.abs(actual - expected) > 0.08)
        problems.push(`${description}: ${actual}, expected ${expected}`);
    };
    const fonts = new Map();
    const measureFont = (style) => {
      const key = [style.fontFamily, style.fontSize, style.fontWeight].join("/");
      if (fonts.has(key)) return fonts.get(key);
      const probe = document.createElement("span");
      Object.assign(probe.style, {
        position: "fixed",
        top: "0",
        left: "0",
        visibility: "hidden",
        contain: "strict",
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        width: "1cap",
        height: "1ex",
      });
      document.documentElement.append(probe);
      const { width: cap, height: xHeight } = probe.getBoundingClientRect();
      probe.remove();
      const metrics = { cap, xHeight };
      fonts.set(key, metrics);
      return metrics;
    };
    for (const line of document.querySelectorAll(expected.lines.selector)) {
      if (!line.checkVisibility()) continue;
      const mark = line.querySelector(":scope > .dot, :scope > .all-star-mark");
      const name = line.querySelector(expected.lines.name);
      if (!mark || !name) continue;
      const style = getComputedStyle(name);
      const role =
        expected.roleSelectors.find(({ selector }) => line.matches(selector))?.role ?? "team";
      const { size, weight: baseWeight, diameter, before, after, font } = expected.roles[role];
      const weight = expected.weightChanges.reduce(
        (weight, { selector, delta }) => weight + (line.matches(selector) ? delta : 0),
        baseWeight,
      );
      const isAfter = mark.getBoundingClientRect().left > name.getBoundingClientRect().left;
      const { cap, xHeight } = measureFont(style);
      const center = findMiddle(name) + (isAfter && role !== "label" ? (cap - xHeight) / 2 : 0);
      const text = name.textContent.trim();
      const description = `${role} ${isAfter ? "after" : "before"} ${text}`;
      roles.add(role);
      placements.add(`${role} ${isAfter ? "after" : "before"}`);
      names.add(text);
      if (line.closest(".tbd") || name.matches(".tbd") || text === "TBD") states.add("TBD");
      if (line.closest(".won, .winner")) states.add("winner");
      for (const { selector, state } of expected.stateSelectors)
        if (line.matches(selector)) states.add(state);
      check(parseFloat(style.fontSize), size, `${description} size`);
      check(Number(style.fontWeight), weight, `${description} weight`);
      check(name.getBoundingClientRect().height, cap, `${description} cap trim`);
      if (!style.fontFamily.startsWith(`"${font}"`) && !style.fontFamily.startsWith(`${font},`))
        problems.push(`${description} font ${style.fontFamily}`);
      if (mark.matches(".all-star-mark")) {
        states.add("All-Star");
        check(
          mark.getBoundingClientRect().width,
          expected.allStar.width,
          `${description} star scale`,
        );
        check(
          findMiddle(mark) - findMiddle(name),
          expected.allStar.offset,
          `${description} star position`,
        );
      } else {
        check(mark.getBoundingClientRect().width, diameter, `${description} dot width`);
        check(mark.getBoundingClientRect().height, diameter, `${description} dot height`);
        check(findMiddle(mark) - center, isAfter ? after : before, `${description} dot center`);
      }
      const seed = line.querySelector(":scope > .seed");
      const seedOffsets = expected.seeds[role];
      if (seed && seedOffsets) {
        attachments.add(`${role} seed ${isAfter ? "after" : "before"}`);
        check(
          findMiddle(seed) - center,
          isAfter ? seedOffsets.after : seedOffsets.before,
          `${description} seed center`,
        );
      }
      for (const attachment of expected.attachments) {
        const match = attachment.parents
          .map((selector) => line.closest(selector))
          .filter(Boolean)
          .map((parent) => ({ parent, element: parent.querySelector(attachment.selector) }))
          .find(({ element }) => element);
        if (!match) continue;
        if (
          attachment.gridAreas &&
          getComputedStyle(match.parent).gridTemplateAreas !== attachment.gridAreas
        )
          continue;
        attachments.add(attachment.name);
        const reference =
          findMiddle(name) + (attachment.center === "lowercase" ? (cap - xHeight) / 2 : 0);
        check(
          findMiddle(match.element) - reference,
          attachment.offset,
          `${description} ${attachment.name}`,
        );
      }
    }
    for (const placeholder of expected.placeholders.flatMap((selector) => [
      ...document.querySelectorAll(selector),
    ])) {
      if (!placeholder.checkVisibility()) continue;
      states.add("TBD");
      const style = getComputedStyle(placeholder);
      check(parseFloat(style.fontSize), expected.roles.team.size, "TBD size");
      check(Number(style.fontWeight), expected.roles.team.weight, "TBD weight");
    }
    return {
      problems,
      roles: [...roles],
      placements: [...placements],
      states: [...states],
      names: [...names],
      attachments: [...attachments],
    };
  }, expectations);

  for (const baseline of expectations.baselines) {
    for (const head of await page.locator(baseline.selector).all()) {
      if (!(await head.isVisible())) continue;
      const name = head.locator(baseline.name).first();
      if (!(await name.count())) continue;
      const note = head.locator(baseline.note).last();
      const [nameCapitals, noteCapitals] = await Promise.all([
        readCapitals(name),
        readCapitals(note),
      ]);
      if (Math.abs(nameCapitals.bottom - noteCapitals.bottom) > 0.08)
        drawn.problems.push(
          `heading baseline: ${nameCapitals.bottom}, expected ${noteCapitals.bottom}`,
        );
      drawn.states.push("baseline heading");
    }
  }
  return drawn;
};
