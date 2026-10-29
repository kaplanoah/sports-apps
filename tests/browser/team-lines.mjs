/**
 * Real team-line geometry, measured against the loaded font's cap and x heights.
 * @param {import("@playwright/test").Page} page
 * @param {"mlb" | "wnba"} league
 */
export const readTeamLines = (page, league) =>
  page.evaluate(async (app) => {
    await document.fonts.ready;
    const values =
      app === "mlb"
        ? {
            small: [12.75, 400, 10, 0, -0.5],
            team: [13.5, 400, 14, 0, -1.5],
            large: [16, 525, 16, -0.5, -1.5],
            label: [12, 400, 14, -0.25, -0.25],
          }
        : {
            small: [14.5, 400, 10, 0, -1],
            team: [15.5, 500, 14, 0, -1],
            large: [17.75, 500, 16, -0.75, -1],
            label: [13, 600, 14, -0.25, -0.25],
          };
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
      const role = line.closest(".news-teams, .runs-half-head")
        ? "label"
        : line.matches(".team-title") ||
            (app === "wnba" && line.closest(".team-line, .faceoff-side"))
          ? "large"
          : line.matches(".game-card-opponent") ||
              (app === "mlb" && line.closest(".rank-id, .pitcher-id"))
            ? "small"
            : "team";
      const [size, baseWeight, diameter, before, after] = values[role];
      const weight =
        baseWeight +
        (app === "mlb" && line.closest(".game-side.won") ? 150 : 0) -
        (app === "wnba" && line.matches(".tbd") && line.closest(".team-line") ? 100 : 0);
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
        check(middle(mark) - middle(name), app === "mlb" ? -3 : -1, `${description} star position`);
      } else {
        check(mark.getBoundingClientRect().width, diameter, `${description} dot width`);
        check(mark.getBoundingClientRect().height, diameter, `${description} dot height`);
        check(middle(mark) - center, isAfter ? after : before, `${description} dot center`);
      }
      const seed = line.querySelector(":scope > .seed");
      if (seed && app === "wnba") {
        attachments.add(`${role} seed ${isAfter ? "after" : "before"}`);
        const offset = isAfter ? -0.25 : role === "large" ? 0.75 : 0;
        check(middle(seed) - center, offset, `${description} seed center`);
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
            middle(attachment) - (middle(name) + (cap - x) / 2),
            offset,
            `${description} ${selector}`,
          );
        }
      }
      const row = line.closest(".team-line");
      const label = row?.querySelector(".seed-label");
      if (label) {
        attachments.add("outside seed");
        check(middle(label) - middle(name), 0, `${description} outside seed`);
      }
      const identity = line.closest(".team-id");
      const rank =
        identity?.querySelector(".rank-tag") ?? line.closest("tr")?.querySelector(".rank-tag");
      if (rank) {
        attachments.add("rank chip");
        check(middle(rank) - middle(name), 0, `${description} rank chip`);
      }
      const ranking = line.closest(".rank-id");
      const chip = ranking?.querySelector(".league-tag");
      if (chip && getComputedStyle(ranking).gridTemplateAreas === '"club league drought"') {
        attachments.add("league chip");
        check(middle(chip) - (middle(name) + (cap - x) / 2), -1, `${description} league chip`);
      }
    }
    for (const placeholder of document.querySelectorAll(".tbd:not(.club)")) {
      if (!placeholder.checkVisibility()) continue;
      states.add("TBD");
      const style = getComputedStyle(placeholder);
      check(parseFloat(style.fontSize), values.team[0], "TBD size");
      check(Number(style.fontWeight), values.team[1], "TBD weight");
    }
    return {
      problems,
      roles: [...roles],
      placements: [...placements],
      states: [...states],
      names: [...names],
      attachments: [...attachments],
    };
  }, league);
