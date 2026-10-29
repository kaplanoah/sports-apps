import { readCapitals } from "./capitals.mjs";

export const ALIGNMENT_TOLERANCE = 0.08;

/**
 * Real team-line geometry, measured against the loaded font's cap and x heights.
 * @param {import("@playwright/test").Page} page
 * @param {"mlb" | "wnba"} league
 */
export const readTeamLines = async (page, league) => {
  const configuration = { app: league, tolerance: ALIGNMENT_TOLERANCE };
  const drawn = await page.evaluate(async ({ app, tolerance }) => {
    await document.fonts.ready;
    const values =
      app === "mlb"
        ? {
            small: { size: 12.75, weight: 400, dot: 10, before: 0, after: -0.5 },
            team: { size: 13.5, weight: 400, dot: 14, before: 0, after: -1.5 },
            large: { size: 16, weight: 525, dot: 16, before: -0.5, after: -1.5 },
            label: { size: 12, weight: 400, dot: 14, before: -0.25, after: -0.25 },
          }
        : {
            small: { size: 14.5, weight: 400, dot: 10, before: 0, after: -1 },
            team: { size: 15.5, weight: 500, dot: 14, before: 0, after: -1 },
            large: { size: 17.75, weight: 500, dot: 16, before: -0.75, after: -1 },
            label: { size: 13, weight: 600, dot: 14, before: -0.25, after: -0.25 },
          };
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
      if (Math.abs(actual - expected) > tolerance)
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
    /**
     * @param {Element} line
     * @returns {"small" | "team" | "large" | "label"}
     */
    const chooseRole = (line) => {
      if (line.closest(".news-teams, .runs-half-head")) return "label";
      if (line.matches(".team-title")) return "large";
      if (app === "wnba" && line.closest(".team-line, .faceoff-side")) return "large";
      if (line.matches(".game-card-opponent")) return "small";
      if (app === "mlb" && line.closest(".rank-id, .pitcher-id")) return "small";
      return "team";
    };
    /**
     * @param {Element} line
     * @param {number} baseWeight
     */
    const findExpectedWeight = (line, baseWeight) => {
      if (app === "mlb" && line.closest(".game-side.won")) return baseWeight + 150;
      if (app === "wnba" && line.matches(".tbd") && line.closest(".team-line"))
        return baseWeight - 100;
      return baseWeight;
    };
    for (const line of document.querySelectorAll(
      ".club, .team-title, .game-card-opponent, .runs-half-head",
    )) {
      if (!line.checkVisibility() || line.closest("[inert]")) continue;
      const mark = line.querySelector(":scope > .dot, :scope > .all-star-mark");
      const name = line.querySelector(
        ":scope > .team-name, :scope > .tbd, :scope > .game-card-name, :scope.team-title > span:not(.dot), :scope.runs-half-head > span:not(.dot)",
      );
      if (!mark || !name) continue;
      const style = getComputedStyle(name);
      const role = chooseRole(line);
      const { size, weight: baseWeight, dot: diameter, before, after } = values[role];
      const weight = findExpectedWeight(line, baseWeight);
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
      if (line.closest(".field-heads")) states.add("field comparison");
      check(parseFloat(style.fontSize), size, `${description} size`);
      check(Number(style.fontWeight), weight, `${description} weight`);
      check(name.getBoundingClientRect().height, cap, `${description} cap trim`);
      const font =
        app === "mlb" ? "Libre Franklin" : role === "label" ? "Barlow" : "Barlow Condensed";
      if (!style.fontFamily.startsWith(`"${font}"`) && !style.fontFamily.startsWith(`${font},`))
        problems.push(`${description} font ${style.fontFamily}`);
      if (mark.matches(".all-star-mark")) {
        states.add("All-Star");
        check(
          mark.getBoundingClientRect().width,
          app === "mlb" ? 19 : 18.5,
          `${description} star scale`,
        );
        check(
          findMiddle(mark) - findMiddle(name),
          app === "mlb" ? -3 : -1,
          `${description} star position`,
        );
      } else {
        check(mark.getBoundingClientRect().width, diameter, `${description} dot width`);
        check(mark.getBoundingClientRect().height, diameter, `${description} dot height`);
        check(findMiddle(mark) - center, isAfter ? after : before, `${description} dot center`);
        if (app === "mlb" && line.closest(".game-side, .news-teams"))
          check(line.getBoundingClientRect().height, diameter, `${description} line height`);
      }
      const seed = line.querySelector(":scope > .seed");
      if (seed && app === "wnba") {
        attachments.add(`${role} seed ${isAfter ? "after" : "before"}`);
        const offset = isAfter ? -0.25 : role === "large" ? 0.75 : 0;
        check(findMiddle(seed) - center, offset, `${description} seed center`);
      }
      const cell = line.closest(".team-cell");
      if (cell) {
        for (const [selector, offset] of /** @type {[string, number][]} */ ([
          [".conference-tag", -1.75],
          [".seed-note", -0.5],
        ])) {
          const attachment = cell.querySelector(selector);
          if (!attachment) continue;
          attachments.add(selector);
          check(
            findMiddle(attachment) - (findMiddle(name) + (cap - xHeight) / 2),
            offset,
            `${description} ${selector}`,
          );
        }
      }
      const row = line.closest(".team-line");
      const label = row?.querySelector(".seed-label");
      if (label) {
        attachments.add("outside seed");
        check(findMiddle(label) - findMiddle(name), 0, `${description} outside seed`);
      }
      const identity = line.closest(".team-id");
      const rank =
        identity?.querySelector(".rank-tag") ?? line.closest("tr")?.querySelector(".rank-tag");
      if (rank) {
        attachments.add("rank chip");
        check(findMiddle(rank) - findMiddle(name), 0, `${description} rank chip`);
      }
      const ranking = line.closest(".rank-id");
      const chip = ranking?.querySelector(".league-tag");
      if (chip && getComputedStyle(ranking).gridTemplateAreas === '"club league drought"') {
        attachments.add("league chip");
        check(
          findMiddle(chip) - (findMiddle(name) + (cap - xHeight) / 2),
          -1,
          `${description} league chip`,
        );
      }
    }
    for (const placeholder of document.querySelectorAll(
      ".matchup-row .tbd, .game-side .club > .tbd, .series-opp .tbd",
    )) {
      if (!placeholder.checkVisibility() || placeholder.closest("[inert]")) continue;
      states.add(placeholder.textContent.trim());
      const style = getComputedStyle(placeholder);
      check(parseFloat(style.fontSize), values.team.size, "TBD size");
      check(Number(style.fontWeight), values.team.weight, "TBD weight");
    }
    return {
      problems,
      roles: [...roles],
      placements: [...placements],
      states: [...states],
      names: [...names],
      attachments: [...attachments],
    };
  }, configuration);

  if (league === "mlb") {
    const heads = page.locator(
      ".field-heads, .sheet-part-head:has(h3 .club):has(> span), .series-row:has(.club)",
    );
    for (const head of await heads.all()) {
      if (!(await head.isVisible())) continue;
      if (await head.evaluate((element) => Boolean(element.closest("[inert]")))) continue;
      const name = head.locator(".team-name").first();
      if (!(await name.count())) continue;
      const note = head.locator(":scope > span").last();
      const [nameCapitals, noteCapitals] = await Promise.all([
        readCapitals(name),
        readCapitals(note),
      ]);
      if (Math.abs(nameCapitals.bottom - noteCapitals.bottom) > ALIGNMENT_TOLERANCE)
        drawn.problems.push(
          `club baseline: ${nameCapitals.bottom}, expected ${noteCapitals.bottom}`,
        );
      const isSeries = await head.evaluate((element) => element.matches(".series-row"));
      drawn.states.push(isSeries ? "baseline series" : "baseline heading");
    }
  }
  return drawn;
};
