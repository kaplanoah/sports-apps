import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listAppStylesheets,
  listRootTokens,
  listSharedStylesheets,
  listStylesheets,
  readDeclarations,
  readRule,
} from "./css-rules.js";

// The page's base size, which every shown text replaces with its role's, a code field sized for its
// box, a cell whose text never shows, and a game's TBD at its side's size.
const OWN_SIZES = new Set([
  "body { font-size: 16px }",
  ".code-field { font-size: 1.5rem }",
  "table.standings tr.playoff-line td { font-size: 0 }",
  ".game-side .tbd { font-size: inherit }",
]);

const ROLE_SIZE = /^var\(--type-([a-z-]+)-size\)$/;

// A font face, or the page's tokens in a theme or not, as against a theme's rule for a part.
/** @param {string} rule */
const isTokenRule = (rule) => /^(@font-face|:root(\[[^\]]*\]|:not\(\[[^\]]*\]\))*)$/.test(rule);

/** @param {string} path */
const readBlocks = (path) => {
  /** @type {Map<string, Map<string, string>>} */
  const blocks = new Map();
  for (const declaration of readDeclarations(path)) {
    if (isTokenRule(readRule(declaration))) continue;
    const key = declaration.selectors.join(" ");
    if (!blocks.has(key)) blocks.set(key, new Map());
    blocks.get(key)?.set(declaration.property, declaration.value);
  }
  return [...blocks].map(([key, properties]) => ({ rule: key, properties }));
};

/** Each size a stylesheet sets some other way than from a role. @param {string} path */
const listStraySizes = (path) =>
  readDeclarations(path)
    .filter((declaration) => declaration.property === "font-size")
    .filter((declaration) => !isTokenRule(readRule(declaration)))
    .map((declaration) => `${readRule(declaration)} { font-size: ${declaration.value} }`)
    .filter((text) => !OWN_SIZES.has(text))
    .filter((text) => !/font-size: var\(--type-[a-z-]+-size\) }$/.test(text));

/**
 * Each rule that sets a role's size without the same role's weight, or a step from it.
 * @param {string} path
 */
const listStrayWeights = (path) =>
  readBlocks(path).flatMap(({ rule, properties }) => {
    const role = ROLE_SIZE.exec(properties.get("font-size") ?? "")?.[1];
    if (!role || role === "field") return [];
    const weight = properties.get("font-weight") ?? "";
    const fromRole = new RegExp(
      `^(var\\(--type-${role}-weight\\)|calc\\(var\\(--type-${role}-weight\\) [-+] \\d+\\))$`,
    );
    return fromRole.test(weight) ? [] : [`${rule} { ${role}: font-weight ${weight || "unset"} }`];
  });

const TRACKED_ROLES = ["heading", "label"];

/**
 * Each rule that sets a tracked role's size without the same role's letter spacing.
 * @param {string} path
 */
const listStrayTracking = (path) =>
  readBlocks(path).flatMap(({ rule, properties }) => {
    const role = ROLE_SIZE.exec(properties.get("font-size") ?? "")?.[1];
    if (!role || !TRACKED_ROLES.includes(role)) return [];
    const spacing = properties.get("letter-spacing") ?? "unset";
    return spacing === `var(--type-${role}-tracking)`
      ? []
      : [`${rule} { ${role}: letter-spacing ${spacing} }`];
  });

/** The roles a stylesheet sizes or weighs text with. @param {string} path */
const listRolesUsed = (path) =>
  new Set(
    readDeclarations(path)
      .filter((declaration) => !isTokenRule(readRule(declaration)))
      .flatMap((declaration) => [
        ...declaration.value.matchAll(/--type-([a-z-]+?)-(?:size|weight)\b/g),
      ])
      .map(([, role]) => role)
      .filter((role) => role !== "field"),
  );

test("every size the stylesheets set comes from a type role", () => {
  for (const path of listStylesheets()) assert.deepEqual(listStraySizes(path), [], path);
});

test("every rule that sets a role's size sets its weight from the same role", () => {
  for (const path of listStylesheets()) assert.deepEqual(listStrayWeights(path), [], path);
});

test("every rule that sets a heading's or label's size sets its role's letter spacing", () => {
  for (const path of listStylesheets()) assert.deepEqual(listStrayTracking(path), [], path);
});

test("every app sets the letter spacing of each tracked role", () => {
  for (const path of listAppStylesheets()) {
    const tokens = listRootTokens(path);
    const missing = TRACKED_ROLES.map((role) => `--type-${role}-tracking`).filter(
      (token) => !tokens.has(token),
    );
    assert.deepEqual(missing, [], path);
  }
});

test("every app sets the size and weight of each role its page uses", () => {
  const sharedRoles = listSharedStylesheets().flatMap((path) => [...listRolesUsed(path)]);
  for (const path of listAppStylesheets()) {
    const tokens = listRootTokens(path);
    const roles = new Set([...sharedRoles, ...listRolesUsed(path)]);
    const missing = [...roles].flatMap((role) =>
      [`--type-${role}-size`, `--type-${role}-weight`].filter((token) => !tokens.has(token)),
    );
    assert.deepEqual(missing, [], path);
  }
});

// A line height in pixels is a box of the layout's, which keeps its pixels whatever the font.
test("every line height set by its text's size is a share of the app's leading", () => {
  for (const path of listStylesheets()) {
    const strays = readDeclarations(path)
      .filter((declaration) => declaration.property === "line-height")
      .filter(
        (declaration) =>
          !/^(var\(--leading\)|calc\([\d.]+ \* var\(--leading\)\)|[\d.]+px|normal|inherit|0)$/.test(
            declaration.value,
          ),
      )
      .map((declaration) => `${readRule(declaration)} { line-height: ${declaration.value} }`);
    assert.deepEqual(strays, [], path);
  }
});
