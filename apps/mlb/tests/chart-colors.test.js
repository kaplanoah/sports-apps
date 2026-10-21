import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { TEAMS } from "../page/js/teams.js";
import { readOklab } from "../../../shared/page/team-colors.js";
import { readThemeToken } from "../../../tests/css-rules.js";

const STYLES = fileURLToPath(new URL("../page/styles.css", import.meta.url));
// What a number in a club's color needs to read, as WCAG asks of text its size, and how far past it
// a color made lighter may go.
const SMALLEST_CONTRAST = 4.5;
const CONTRAST_ROOM = 0.1;
// How far apart two hues may be and still read as the same color.
const SAME_HUE_DEGREES = 3;
const BLACK_STAND_IN = "#e4e4e4";
const WHITE_STAND_IN = "#6f6e6e";
// A lightened color with less chroma than this, in OKLCH, reads as gray more than as the club's.
const MUTED_CHROMA = 0.075;

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

/** @param {string} hex */
const isNearBlack = (hex) => measureLuminance(hex) < 0.02;

/** @param {string} hex */
const isNearWhite = (hex) => measureLuminance(hex) > 0.9;

// Each theme's colors for a club's starter, and the page and card they read on.
const THEMES = {
  "Night Game": {
    readColors: (club) => club.chartColors,
    surfaces: [readThemeToken(STYLES, "dark", "--card"), readThemeToken(STYLES, "dark", "--bg")],
  },
  Ball: {
    readColors: (club) => club.lightChartColors,
    surfaces: [readThemeToken(STYLES, "light", "--card"), readThemeToken(STYLES, "light", "--bg")],
  },
};

test("every club's two chart colors read as text on the sheet and the page, in each theme", () => {
  for (const [theme, { readColors, surfaces }] of Object.entries(THEMES))
    for (const [code, club] of Object.entries(TEAMS))
      for (const color of readColors(club))
        for (const surface of surfaces) {
          const contrast = measureContrast(color, surface);
          assert.ok(
            contrast >= SMALLEST_CONTRAST,
            `${theme}: ${code}'s ${color} on ${surface} is ${contrast.toFixed(2)} to 1`,
          );
        }
});

test("each Ball chart color is one of the club's own colors, or its hue made only as dark as reading needs, or gray for white, first color first", () => {
  const surface = readThemeToken(STYLES, "light", "--bg");
  for (const [code, club] of Object.entries(TEAMS)) {
    const own = [club.color, club.color2];
    club.lightChartColors.forEach((color, index) => {
      const from = own[index];
      if (from.toLowerCase() === color) return;
      if (color === WHITE_STAND_IN) {
        assert.ok(isNearWhite(from), `${code}'s ${from} isn't white for ${color} to stand in for`);
        return;
      }
      assert.ok(
        measureHueGap(from, color) <= SAME_HUE_DEGREES,
        `${code}'s ${color} loses ${from}'s hue`,
      );
      const contrast = measureContrast(color, surface);
      assert.ok(
        contrast <= SMALLEST_CONTRAST + CONTRAST_ROOM,
        `${code}'s ${color} goes past what reading needs, at ${contrast.toFixed(2)} to 1`,
      );
    });
  }
});

test("each Night Game chart color is one of the club's own colors, or its hue made only as light as reading needs, or light gray for black", () => {
  const surface = readThemeToken(STYLES, "dark", "--card");
  for (const [code, club] of Object.entries(TEAMS)) {
    const own = [club.color, club.color2];
    for (const color of club.chartColors) {
      if (own.some((hex) => hex.toLowerCase() === color)) continue;
      if (color === BLACK_STAND_IN) {
        assert.ok(own.some(isNearBlack), `${code} has no black for ${color} to stand in for`);
        continue;
      }
      assert.ok(
        own.some((hex) => measureHueGap(hex, color) <= SAME_HUE_DEGREES),
        `${code}'s ${color} keeps neither ${club.color}'s hue nor ${club.color2}'s`,
      );
      const contrast = measureContrast(color, surface);
      assert.ok(
        contrast <= SMALLEST_CONTRAST + CONTRAST_ROOM,
        `${code}'s ${color} goes past what reading needs, at ${contrast.toFixed(2)} to 1`,
      );
    }
  }
});

test("each club leads with its dot's first color, unless that comes out muted and its other color has more color", () => {
  /** @param {string} hex */
  const measureChroma = (hex) => {
    const [, greenRed, blueYellow] = readOklab(hex);
    return Math.hypot(greenRed, blueYellow);
  };
  /** @param {string} own @param {string} chart */
  const isFrom = (own, chart) =>
    own.toLowerCase() === chart ||
    (chart === BLACK_STAND_IN ? isNearBlack(own) : measureHueGap(own, chart) <= SAME_HUE_DEGREES);
  const leadingWithOther = [];
  for (const [code, club] of Object.entries(TEAMS)) {
    const [first, other] = club.chartColors;
    assert.notEqual(first, other, `${code}'s two chart colors are the same`);
    const fromFirst = isFrom(club.color, first) ? first : other;
    const fromOther = fromFirst === first ? other : first;
    assert.ok(isFrom(club.color2, fromOther), `${code}'s ${fromOther} isn't from ${club.color2}`);
    const isMuted =
      measureChroma(fromFirst) < MUTED_CHROMA &&
      measureChroma(fromOther) > measureChroma(fromFirst);
    assert.equal(first, isMuted ? fromOther : fromFirst, `${code} leads with the wrong color`);
    if (isMuted) leadingWithOther.push(code);
  }
  assert.deepEqual(leadingWithOther, ["CWS", "CLE", "DET", "MIL", "ATH", "PIT", "SD"]);
});
