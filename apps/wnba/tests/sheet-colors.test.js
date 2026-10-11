import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatMarkColors, formatSheetColors, pickSheetColors } from "../page/js/sheet-colors.js";
import { measureColorDistance, readOklab } from "../../../shared/page/team-colors.js";
import { TEAMS } from "../page/js/teams.js";

const STYLES = readFileSync(`${import.meta.dirname}/../page/styles.css`, "utf8");
const THEMES = /** @type {const} */ (["light", "dark"]);
const CODES = Object.keys(TEAMS);
// What a team's name needs to read, as WCAG asks of text its size.
const SMALLEST_CONTRAST = 4.5;
// What a mark needs to stand out, as WCAG asks of a graphic, and how far past it a mark made
// darker or lighter may go.
const MARK_CONTRAST = 3;
const MARK_CONTRAST_ROOM = 0.1;
// How far apart two hues may be and still read as the same color.
const SAME_HUE_DEGREES = 3;
// A dot's half this dark reads as black.
const BLACK_LUMINANCE = 0.01;
// A light half looks largest against black, so it takes this share of the dot.
const LIGHT_ON_BLACK_SPLIT = 48;

/**
 * A token's value in the block of styles.css that a selector opens.
 * @param {string} selector
 * @param {string} token
 */
function readToken(selector, token) {
  const block = STYLES.slice(STYLES.indexOf(`${selector} {`));
  return block.match(new RegExp(`${token}: (#[0-9a-f]{6});`))[1];
}

/** @param {string} hex */
function measureLuminance(hex) {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * @param {string} first
 * @param {string} second
 */
function measureContrast(first, second) {
  const [lighter, darker] = [measureLuminance(first), measureLuminance(second)].sort(
    (one, other) => other - one,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

test("every dot with a black half gives its light half the same smaller share", () => {
  const shares = CODES.flatMap((code) => {
    const { color, color2, dotSplit } = TEAMS[code];
    if (measureLuminance(color2) < BLACK_LUMINANCE) return [[code, dotSplit]];
    if (measureLuminance(color) < BLACK_LUMINANCE) return [[code, 100 - dotSplit]];
    return [];
  });
  assert.deepEqual(
    shares.map(([code]) => code),
    ["GSV", "LVA", "NYL"],
  );
  assert.deepEqual(
    shares,
    shares.map(([code]) => [code, LIGHT_ON_BLACK_SPLIT]),
  );
});

// The lead chart's tile is a mix of the sheet and the floor, so reading on both reads on it too.
const CHART_SURFACES = {
  light: [readToken(":root", "--card"), readToken(":root", "--bg")],
  dark: [
    readToken(':root[data-theme="dark"]', "--card"),
    readToken(':root[data-theme="dark"]', "--bg"),
  ],
};

/**
 * The shade of a team's chart color its name reads in: its name color for its first choice, if it
 * keeps one, or the color itself.
 * @param {string} code
 * @param {"light" | "dark"} theme
 * @param {number} choice
 */
function readNameColor(code, theme, choice) {
  const team = TEAMS[code];
  const nameColor = choice === 0 && "nameColors" in team ? team.nameColors[theme] : undefined;
  return nameColor ?? team.chartColors[theme][choice];
}

test("every team's chart colors stand out as marks, and its name reads in each of them or in its darker shade, on the sheet and the floor, on each theme", () => {
  for (const code of CODES) {
    for (const theme of THEMES) {
      TEAMS[code].chartColors[theme].forEach((color, choice) => {
        const nameColor = readNameColor(code, theme, choice);
        for (const surface of CHART_SURFACES[theme]) {
          const markContrast = measureContrast(color, surface);
          const nameContrast = measureContrast(nameColor, surface);
          assert.ok(
            markContrast >= MARK_CONTRAST,
            `${code}'s ${color} on ${surface} is ${markContrast.toFixed(2)} to 1`,
          );
          assert.ok(
            nameContrast >= SMALLEST_CONTRAST,
            `${code}'s name in ${nameColor} on ${surface} is ${nameContrast.toFixed(2)} to 1`,
          );
        }
      });
    }
  }
});

test("a team keeps a darker shade for its name only where its first chart color is too light to read as text, in that color's hue", () => {
  for (const code of CODES) {
    const team = TEAMS[code];
    if (!("nameColors" in team)) continue;
    for (const [theme, nameColor] of Object.entries(team.nameColors)) {
      const color = team.chartColors[/** @type {"light" | "dark"} */ (theme)][0];
      const contrasts = CHART_SURFACES[/** @type {"light" | "dark"} */ (theme)].map((surface) =>
        measureContrast(color, surface),
      );
      assert.ok(
        Math.min(...contrasts) < SMALLEST_CONTRAST,
        `${code}'s ${color} already reads as text`,
      );
      assert.ok(
        measureHueGap(color, nameColor) <= SAME_HUE_DEGREES,
        `${code}'s ${nameColor} turns ${color}'s hue`,
      );
    }
  }
});

/** @param {string} hex */
function readHue(hex) {
  const [, greenRed, blueYellow] = readOklab(hex);
  return (Math.atan2(blueYellow, greenRed) * 180) / Math.PI;
}

/**
 * @param {string} first
 * @param {string} second
 */
function measureHueGap(first, second) {
  const gap = Math.abs(readHue(first) - readHue(second)) % 360;
  return Math.min(gap, 360 - gap);
}

test("every team's mark colors stand out on the sheet, each one of its own colors or that color's hue made only as dark or light as standing out needs", () => {
  assert.match(STYLES, /--sheet: var\(--card\);/, "a sheet is the card's color");
  const sheets = {
    light: readToken(":root", "--card"),
    dark: readToken(':root[data-theme="dark"]', "--card"),
  };
  for (const code of CODES) {
    const { color, color2, markColors } = TEAMS[code];
    for (const theme of THEMES) {
      const mark = markColors[theme];
      const contrast = measureContrast(mark, sheets[theme]);
      const name = `${code}'s ${mark} on ${sheets[theme]}`;
      assert.ok(contrast >= MARK_CONTRAST, `${name} is ${contrast.toFixed(2)} to 1`);
      if ([color, color2].includes(mark)) continue;
      assert.ok(
        [color, color2].some((own) => measureHueGap(own, mark) <= SAME_HUE_DEGREES),
        `${name} keeps neither ${color}'s hue nor ${color2}'s`,
      );
      assert.ok(
        contrast <= MARK_CONTRAST + MARK_CONTRAST_ROOM,
        `${name} goes past what standing out needs, at ${contrast.toFixed(2)} to 1`,
      );
    }
  }
});

test("a player's sheet hands its curves her team's mark color on each theme", () => {
  assert.equal(formatMarkColors("NYL"), "--mark-light: #449274; --mark-dark: #87d5b5;");
});

test("every pairing of teams, either way round, gets two colors that read apart, on each theme", () => {
  for (const away of CODES) {
    for (const home of CODES.filter((code) => code !== away)) {
      for (const theme of THEMES) {
        const colors = pickSheetColors(away, home, theme);
        assert.ok(
          measureColorDistance(colors.away, colors.home) >= 0.15,
          `${away} at ${home} on ${theme}: ${colors.away} and ${colors.home}`,
        );
      }
    }
  }
});

test("the Storm's green and the Fever's navy read apart, so each team keeps its first color either way round, on each theme", () => {
  for (const theme of THEMES) {
    for (const [away, home] of [
      ["IND", "SEA"],
      ["SEA", "IND"],
    ]) {
      assert.deepEqual(pickSheetColors(away, home, theme), {
        away: TEAMS[away].chartColors[theme][0],
        home: TEAMS[home].chartColors[theme][0],
      });
    }
  }
});

// Two dark colors look alike on a mark at a distance that sets lighter ones well apart, so the
// Tempo's bordeaux keeps further from the Aces' black than the sheet asks of two colors.
const DARK_PAIR_DISTANCE = 0.4;

test("the Tempo's bordeaux reads well apart from the Aces' black on Maple", () => {
  const colors = pickSheetColors("TOR", "LVA", "light");
  assert.equal(colors.away, TEAMS.TOR.chartColors.light[0]);
  assert.ok(measureColorDistance(colors.away, colors.home) >= DARK_PAIR_DISTANCE);
});

test("each team keeps its first color unless it looks like the other team's", () => {
  assert.deepEqual(pickSheetColors("GSV", "DAL", "light"), {
    away: TEAMS.GSV.chartColors.light[0],
    home: TEAMS.DAL.chartColors.light[0],
  });
  // The Dream and the Mystics are both red, so the Dream, away, take their blue.
  for (const theme of THEMES)
    assert.deepEqual(pickSheetColors("ATL", "WAS", theme), {
      away: TEAMS.ATL.chartColors[theme][1],
      home: TEAMS.WAS.chartColors[theme][0],
    });
});

test("when neither of the away team's colors reads apart from the home team's first, the home team takes its other", () => {
  // Both of the Storm's colors are too near the Wings' olive, so the Wings take their navy.
  assert.deepEqual(pickSheetColors("SEA", "DAL", "light"), {
    away: TEAMS.SEA.chartColors.light[0],
    home: TEAMS.DAL.chartColors.light[1],
  });
});

test("the sheet's style hands it each side's color on each theme, with the darker shade a side's name reads in where it keeps one, and nothing while a team isn't known", () => {
  assert.equal(
    formatSheetColors("ATL", "WAS"),
    `--away-light: ${TEAMS.ATL.chartColors.light[1]}; --home-light: ${TEAMS.WAS.chartColors.light[0]}; ` +
      `--away-dark: ${TEAMS.ATL.chartColors.dark[1]}; --home-dark: ${TEAMS.WAS.chartColors.dark[0]};`,
  );
  assert.equal(
    formatSheetColors("IND", "SEA"),
    `--away-light: ${TEAMS.IND.chartColors.light[0]}; --home-light: ${TEAMS.SEA.chartColors.light[0]}; --home-name-light: ${TEAMS.SEA.nameColors.light}; ` +
      `--away-dark: ${TEAMS.IND.chartColors.dark[0]}; --home-dark: ${TEAMS.SEA.chartColors.dark[0]};`,
  );
  assert.equal(formatSheetColors(null, "LVA"), "");
});
