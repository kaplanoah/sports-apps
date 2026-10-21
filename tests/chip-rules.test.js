import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  listAppStylesheets,
  listSharedStylesheets,
  readDeclarations,
  readRule,
} from "./css-rules.js";
import { listPageSources } from "./page-sources.js";
import { REPO_ROOT } from "./repo-files.js";

const CHIP_STYLESHEET = "chip.css";

// The two looks and the numbers a chip's markup picks from chip.css, as against its kind.
const CHIP_LOOKS = new Set(["filled", "outlined", "numbers"]);

// What only chip.css sets, so every chip in every app has one height, padding, type, and border,
// and a kind of chip sets its colors only through --chip-ink, --chip-fill, and --chip-line.
const CHIP_ONLY =
  /^(height|min-height|max-height|padding(-[a-z-]+)?|font(-[a-z-]+)?|line-height|letter-spacing|text-indent|text-transform|border(?!(-[a-z]+)*-radius$)(-[a-z-]+)?|color|background(-color)?)$/;

/**
 * A page module's source with each value a template fills in left out, since one may hold quotes.
 * @param {string} path
 */
const readMarkup = (path) =>
  readFileSync(new URL(path, REPO_ROOT), "utf8").replace(/\$\{[^}]*\}/g, " ");

/** Each kind of chip the pages' markup draws, by its class beside `chip`. */
const listChipKinds = () =>
  new Set(
    listPageSources([".js"]).flatMap((path) =>
      [...readMarkup(path).matchAll(/class="chip ([^"]*)"/g)]
        .flatMap(([, classes]) => classes.split(/\s+/))
        .filter((name) => /^[a-z][a-z-]*$/.test(name) && !CHIP_LOOKS.has(name)),
    ),
  );

/**
 * The classes on the element a selector styles, its last compound, leaving out those a pseudo
 * class like :has() or :not() only looks at.
 * @param {string} selector
 */
const listSubjectClasses = (selector) => {
  const compounds = selector
    .replace(/:[a-z-]+\([^)]*\)/g, "")
    .trim()
    .split(/\s*[>+~]\s*|\s+/);
  return [...(compounds.at(-1) ?? "").matchAll(/\.([a-z][a-z-]*)/g)].map(([, name]) => name);
};

/**
 * Each declaration outside chip.css that sets what only chip.css sets, on a chip.
 * @param {Set<string>} chipClasses
 * @param {string} path
 */
const listChipOverrides = (chipClasses, path) =>
  readDeclarations(path)
    .filter((declaration) => CHIP_ONLY.test(declaration.property))
    .filter((declaration) =>
      readRule(declaration)
        .split(",")
        .some((selector) => listSubjectClasses(selector).some((name) => chipClasses.has(name))),
    )
    .map(
      (declaration) => `${readRule(declaration)} { ${declaration.property}: ${declaration.value} }`,
    );

test("the pages draw chips of several kinds, so the check below reaches them", () => {
  const kinds = listChipKinds();
  for (const kind of ["bonus", "conference-tag", "foul-chip", "league-tag", "rank-tag"]) {
    assert.ok(kinds.has(kind), kind);
  }
});

test("only chip.css sets a chip's height, padding, type, border, and colors", () => {
  const chipClasses = new Set(["chip", ...listChipKinds()]);
  const stylesheets = [
    ...listSharedStylesheets().filter((path) => !path.endsWith(`/${CHIP_STYLESHEET}`)),
    ...listAppStylesheets(),
  ];
  assert.deepEqual(
    stylesheets.flatMap((path) => listChipOverrides(chipClasses, path)),
    [],
  );
});
