import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IconStyle, icons } from "@phosphor-icons/core";
import { listPageSources } from "./page-sources.js";
import { readRepoFile } from "./repo-files.js";

/** @param {string} name @param {string} style */
function readPhosphorIcon(name, style) {
  const fileName = style === IconStyle.REGULAR ? name : `${name}-${style}`;
  return readFileSync(
    fileURLToPath(import.meta.resolve(`@phosphor-icons/core/assets/${style}/${fileName}.svg`)),
    "utf8",
  );
}

/** @param {string} markup */
const readPaths = (markup) =>
  [...markup.matchAll(/\sd=(["'])(.*?)\1/gs)].map((match) => match[2].replace(/\s+/g, " ").trim());

/** @type {Map<string, { name: string, style: string }[]>} */
const PHOSPHOR_ICONS_BY_PATH = new Map();
for (const icon of icons) {
  for (const style of Object.values(IconStyle)) {
    for (const path of readPaths(readPhosphorIcon(icon.name, style))) {
      const named = PHOSPHOR_ICONS_BY_PATH.get(path) ?? [];
      PHOSPHOR_ICONS_BY_PATH.set(path, [...named, { name: icon.name, style }]);
    }
  }
}

// An SVG without a viewBox of its own, like the bracket's lines that a script draws in, or with
// one that comes from data, like the scoreboard's digits, is a drawing, not an icon.
/** @param {string} svg */
const isDrawing = (svg) =>
  !/viewBox=["']/.test(svg) || /viewBox=(?:"[^"]*\$\{|'[^']*\$\{)/.test(svg);

/** @param {string} svg */
function describeIconProblem(svg) {
  if (/<(circle|rect|line|polyline|polygon|ellipse)\b/.test(svg)) return "draws a shape of its own";
  const paths = readPaths(svg);
  if (!paths.length) return "has no path";
  if (paths.some((path) => !PHOSPHOR_ICONS_BY_PATH.has(path))) return "has a path Phosphor doesn't";
  return null;
}

// The Home Screen steps' Share and menu glyphs copy the browser's own buttons, so people find
// them, MLB's seed lock is drawn for its small size beside a seed, and the catching-up ring is
// Phosphor's circle-notch at its Light weight with a wider gap.
const HAND_DRAWN_ICONS = {
  "apps/mlb/page/js/games-view.js": 1,
  "shared/page/catch-up-note.js": 1,
  "shared/page/draw-home-screen-asks.js": 2,
};

/** @param {string} source */
const listSvgs = (source) => [
  ...[...source.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((match) => ({
    svg: match[0],
    index: match.index,
  })),
  ...[...source.matchAll(/url\((["'])(data:image\/svg\+xml[^,]*),([\s\S]*?)\1\)/g)].map(
    (match) => ({
      svg: match[2].endsWith(";base64")
        ? Buffer.from(match[3], "base64").toString("utf8")
        : decodeURIComponent(match[3]),
      index: match.index,
    }),
  ),
];

/** @param {string} file */
const countHandDrawnIcons = (file) =>
  listSvgs(readRepoFile(file)).filter(({ svg }) => !isDrawing(svg) && describeIconProblem(svg))
    .length;

test("every icon on the pages is a Phosphor icon, copied path for path, but the named few drawn by hand", () => {
  const counts = Object.fromEntries(
    listPageSources([".js", ".html", ".css"])
      .map((file) => /** @type {[string, number]} */ ([file, countHandDrawnIcons(file)]))
      .filter(([, count]) => count > 0),
  );
  assert.deepEqual(counts, HAND_DRAWN_ICONS);
});

/**
 * Each comment in a page file, a run of `//` lines as one, with where it ends, first to last.
 * @param {string} source
 */
const listComments = (source) =>
  [
    ...source.matchAll(/<!--[\s\S]*?-->/g),
    ...source.matchAll(/\/\*[\s\S]*?\*\//g),
    ...source.matchAll(/(?:^[ \t]*\/\/.*\n?)+/gm),
  ]
    .map((match) => ({ text: match[0], end: match.index + match[0].length }))
    .sort((first, second) => first.end - second.end);

/**
 * Whether a comment says which Phosphor icon this is, by its name and weight.
 * @param {string} comment
 * @param {{ name: string, style: string }} icon
 */
const isNamedIn = (comment, { name, style }) =>
  comment.includes("Phosphor's") &&
  new RegExp(`(?<![a-z-])${name}(?![a-z-])`).test(comment) &&
  new RegExp(`\\b${style} weight\\b`, "i").test(comment);

/**
 * Each Phosphor icon in a page file that the last comment before it doesn't name, as `file:line
 * icon at its weight`.
 * @param {string} file
 */
function listUnnamedIcons(file) {
  const source = readRepoFile(file);
  const comments = listComments(source);
  return listSvgs(source)
    .filter(({ svg }) => !isDrawing(svg) && !describeIconProblem(svg))
    .filter(({ svg, index }) => {
      const icons = readPaths(svg).flatMap((path) => PHOSPHOR_ICONS_BY_PATH.get(path) ?? []);
      const nearest = comments.filter((comment) => comment.end <= index).at(-1);
      return !nearest || !icons.some((icon) => isNamedIn(nearest.text, icon));
    })
    .map(({ svg, index }) => {
      const line = source.slice(0, index).split("\n").length;
      const [icon] = PHOSPHOR_ICONS_BY_PATH.get(readPaths(svg)[0]) ?? [];
      return `${file}:${line} ${icon.name} at its ${icon.style} weight`;
    });
}

test("every Phosphor icon on the pages follows a comment naming the icon and its weight", () => {
  assert.deepEqual(listPageSources([".js", ".html", ".css"]).flatMap(listUnnamedIcons), []);
});

test("pull to refresh's spinner has every one of its eight spokes", () => {
  const [spinner] = readPaths(readRepoFile("shared/page/pull-to-refresh.js"));
  assert.equal(spinner.match(/[Mm]/g)?.length, 8);
});
