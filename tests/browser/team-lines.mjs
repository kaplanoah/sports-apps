/** @typedef {"small" | "team" | "large" | "label"} TeamRole */

/**
 * Independent expected geometry supplied by an app's tests.
 * @typedef {object} TeamLineExpectations
 * @property {Record<TeamRole, { font: string, size: number, weight: number, diameter: number, before: number, after: number }>} roles
 * @property {{ selector: string, role: TeamRole }[]} roleSelectors in priority order
 * @property {{ selector: string, delta: number }[]} weightChanges
 * @property {{ width: number, offset: number }} allStar
 * @property {Partial<Record<TeamRole, { before: number, after: number }>>} seeds
 * @property {{ name: string, parents: string[], selector: string, center: "capital" | "lowercase", offset: number, gridAreas?: string }[]} attachments
 */

/**
 * Real team-line geometry, measured against the loaded font's cap and x heights.
 * @param {import("@playwright/test").Page} page
 * @param {TeamLineExpectations} expectations
 */
export const readTeamLines = (page, expectations) =>
  page.evaluate(async (expected) => {
    await document.fonts.ready;
    const problems = [];
    const roles = new Set();
    const placements = new Set();
    const states = new Set();
    const names = new Set();
    const attachments = new Set();
    const middle = (element) => {
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
        position: "absolute",
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        width: "1cap",
        height: "1ex",
      });
      document.body.append(probe);
      const { width: cap, height: x } = probe.getBoundingClientRect();
      probe.remove();
      const metrics = { cap, x };
      fonts.set(key, metrics);
      return metrics;
    };
    for (const line of document.querySelectorAll(
      ".club, .team-title, .game-card-opponent, .runs-half-head",
    )) {
      if (!line.checkVisibility()) continue;
      const mark = line.querySelector(":scope > .dot, :scope > .all-star-mark");
      const name = line.querySelector(
        ":scope > .team-name, :scope > .tbd, :scope > .game-card-name, :scope.team-title > span:not(.dot), :scope.runs-half-head > span:not(.dot)",
      );
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
      const { cap, x } = measureFont(style);
      const center = middle(name) + (isAfter && role !== "label" ? (cap - x) / 2 : 0);
      const text = name.textContent.trim();
      const description = `${role} ${isAfter ? "after" : "before"} ${text}`;
      roles.add(role);
      placements.add(`${role} ${isAfter ? "after" : "before"}`);
      names.add(text);
      if (line.closest(".tbd") || name.matches(".tbd") || text === "TBD") states.add("TBD");
      if (line.closest(".won, .winner")) states.add("winner");
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
        check(middle(mark) - middle(name), expected.allStar.offset, `${description} star position`);
      } else {
        check(mark.getBoundingClientRect().width, diameter, `${description} dot width`);
        check(mark.getBoundingClientRect().height, diameter, `${description} dot height`);
        check(middle(mark) - center, isAfter ? after : before, `${description} dot center`);
      }
      const seed = line.querySelector(":scope > .seed");
      const seedOffsets = expected.seeds[role];
      if (seed && seedOffsets) {
        attachments.add(`${role} seed ${isAfter ? "after" : "before"}`);
        check(
          middle(seed) - center,
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
        const reference = middle(name) + (attachment.center === "lowercase" ? (cap - x) / 2 : 0);
        check(
          middle(match.element) - reference,
          attachment.offset,
          `${description} ${attachment.name}`,
        );
      }
    }
    for (const placeholder of document.querySelectorAll(
      ".matchup-row .tbd, .game-side .club > .tbd",
    )) {
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
