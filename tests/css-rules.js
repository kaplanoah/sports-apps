import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listApps } from "../worker/apps.mjs";

const SHARED = new URL("../shared/page/", import.meta.url);
const APPS = new URL("../apps/", import.meta.url);

/** The path of each stylesheet the apps' pages share. */
export const listSharedStylesheets = () =>
  readdirSync(SHARED)
    .filter((name) => name.endsWith(".css"))
    .map((name) => fileURLToPath(new URL(name, SHARED)));

/** The path of each app's own stylesheet. */
export const listAppStylesheets = () =>
  listApps().map((app) => fileURLToPath(new URL(`${app}/page/styles.css`, APPS)));

/** @typedef {{ selectors: string[], property: string, value: string }} Declaration */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every declaration in a stylesheet, with the selectors of the blocks it sits in, outermost first,
 * like ["@media (max-width: 779px)", ".tab-bar::before"].
 * @param {string} path
 * @returns {Declaration[]}
 */
export function readDeclarations(path) {
  const css = stripComments(readFileSync(path, "utf8"));
  /** @type {Declaration[]} */
  const declarations = [];
  /** @type {string[]} */
  const selectors = [];
  let text = "";
  const addDeclaration = () => {
    const colon = text.indexOf(":");
    if (colon > 0 && selectors.length) {
      declarations.push({
        selectors: [...selectors],
        property: text.slice(0, colon).trim(),
        value: text.slice(colon + 1).trim(),
      });
    }
    text = "";
  };
  for (const character of css) {
    if (character === "{") {
      selectors.push(text.trim());
      text = "";
    } else if (character === "}") {
      addDeclaration();
      selectors.pop();
    } else if (character === ";") {
      addDeclaration();
    } else {
      text += character;
    }
  }
  return declarations;
}

/**
 * Each `@font-face` in a stylesheet, as its properties by name, with quotes taken off its family.
 * @param {string} path
 * @returns {Record<string, string>[]}
 */
export const readFontFaces = (path) =>
  [...stripComments(readFileSync(path, "utf8")).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(
    ([, block]) => {
      const face = Object.fromEntries(
        block
          .split(";")
          .map((declaration) => declaration.split(/:(.*)/s).map((part) => part.trim()))
          .filter(([property, value]) => property && value),
      );
      return { ...face, "font-family": face["font-family"].replaceAll('"', "") };
    },
  );

/** @param {Declaration} declaration */
export const readRule = (declaration) => declaration.selectors.at(-1) ?? "";

/**
 * The custom properties a stylesheet's `:root` blocks define.
 * @param {string} path
 */
export const listRootTokens = (path) =>
  new Set(
    readDeclarations(path)
      .filter((declaration) => readRule(declaration).startsWith(":root"))
      .map((declaration) => declaration.property),
  );

// The floating tab bar is a capsule in every app and a switch is round, like the phone's own, and
// app icons keep their own shape.
const OWN_SHAPES = new Set([
  ".switch",
  ".tab-bar::before",
  "nav.tabs .tab-list button",
  ".tab-backing",
  ".tab-pill",
  ".home-screen-icon",
  ".home-screen-tip .home-screen-icon",
  ".gate-icon",
  ".appearance-icon",
]);

/**
 * A corner set from the app's shape tokens, or a circle.
 * @param {string} value
 */
const isTokenCorner = (value) => value === "50%" || /var\(--radius-[a-z-]+\)/.test(value);

/** @param {string} rule */
const hasOwnShape = (rule) => rule.split(",").every((selector) => OWN_SHAPES.has(selector.trim()));

/**
 * Each corner a stylesheet sets some other way than from the shape tokens, but for a circle, the
 * tab bar's capsule, a switch, and an app icon.
 * @param {string} path
 */
export const listStrayCorners = (path) =>
  readDeclarations(path)
    .filter((declaration) => /^border(-[a-z]+)*-radius$/.test(declaration.property))
    .filter((declaration) => !hasOwnShape(readRule(declaration)))
    .filter((declaration) => !isTokenCorner(declaration.value))
    .map(
      (declaration) => `${readRule(declaration)} { ${declaration.property}: ${declaration.value} }`,
    );

const HOVER_CHANGE = "color: var(--ink-hover)";

/**
 * Each change a stylesheet makes under a mouse but the one a hover makes, its text or icon taking
 * --ink-hover.
 * @param {string} path
 */
export const listOtherHoverChanges = (path) =>
  readDeclarations(path)
    .filter((declaration) => readRule(declaration).includes(":hover"))
    .filter((declaration) => `${declaration.property}: ${declaration.value}` !== HOVER_CHANGE)
    .map(
      (declaration) => `${readRule(declaration)} { ${declaration.property}: ${declaration.value} }`,
    );
