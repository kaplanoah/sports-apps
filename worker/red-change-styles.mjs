// What a change to a page's stylesheets does to how iOS layers, stacks, scrolls, and shows its
// parts, for worker/red-change.mjs. Each stylesheet is read with esbuild before and after the
// change, and a declaration's verdict can hang on what every page stylesheet sets for the same
// part, like a transition in one rule that moves the transform another sets.
import { transformSync } from "esbuild";
import { isSharedOrderKept, readBothSides, subtractEach } from "./changed-files.mjs";

/** @typedef {import("./changed-files.mjs").ChangedFile} ChangedFile */
/** @typedef {import("./changed-files.mjs").ReadPageFile} ReadPageFile */

export const LAYER_PROPERTIES = [
  "transform",
  "translate",
  "rotate",
  "scale",
  "perspective",
  "backface-visibility",
  "filter",
  "backdrop-filter",
  "mask",
  "mask-image",
  "clip-path",
  "will-change",
  "animation",
  "transition",
  "contain",
  "content-visibility",
];

// Beside the layers, what in the shared stylesheets decides how iOS stacks, scrolls, and shows
// the page's parts: where a part sits over others, what scrolls and takes a touch, whether a part
// draws at all, and a container's containment, which stacks and holds what it contains. Their
// fonts, colors, spacing, and sizes CI checks as an iPhone shows them.
const STACK_PROPERTIES = [
  ...LAYER_PROPERTIES,
  "position",
  "overflow",
  "overscroll-behavior",
  "scroll-snap",
  "touch-action",
  "pointer-events",
  "z-index",
  "opacity",
  "visibility",
  "display",
  "isolation",
  "mix-blend-mode",
  "container",
];

const OVERFLOW_AXES = /^overflow(?:-x|-y|-inline|-block)?$/;
const HIDING_DISPLAY = /^(?:none|contents)$/i;
const IN_FLOW_POSITION = /^(?:relative|static)$/i;
const CSS_WIDE_KEYWORD = /^(?:inherit|initial|unset|revert|revert-layer)$/i;

// What a transition's list holds beside the property it eases: its times, its easing, and how it
// treats a property that can't ease.
const TRANSITION_TIMING =
  /^(?:-?[\d.]+m?s|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete)$|\(/i;

// The transform functions, and the most values each transform property holds, that stay in two
// dimensions, which WebKit paints with the rest of the page unless something moves them.
const FLAT_TRANSFORM_FUNCTION = /^(?:translate[xy]?|rotate|scale[xy]?)\(/i;
const FLAT_TRANSFORM_VALUES = new Map([
  ["translate", 2],
  ["rotate", 1],
  ["scale", 2],
]);

/** @typedef {{ property: string, value: string }} Declaration */
/**
 * @typedef {object} StyleRule
 * @property {string[]} reaches each selector the rule reaches, after the at-rules and selectors
 *   around it
 * @property {string[][]} subjects the simple selectors of the part each selector styles, none
 *   where they can't be told
 * @property {Declaration[]} declarations
 * @property {boolean} isKeyframe whether it's a step of an animation's keyframes
 */
/** @typedef {{ statement: string }} StyleStatement a top-level statement, like `@layer a,b` */
/** @typedef {StyleRule | StyleStatement} StyleItem */
/**
 * @typedef {object} IndexedRule what a rule of a page stylesheet does to the parts it styles
 * @property {string[][]} subjects
 * @property {boolean} isMoving whether it animates, eases, or names a will-change
 * @property {boolean} isStacking whether it sets a z-index or takes a part out of the flow
 * @property {boolean} hidesDisplay whether its display hides a part or its box
 */
/**
 * @typedef {object} StyleIndex what every page stylesheet sets, before the change and after it
 * @property {IndexedRule[]} rules
 * @property {boolean} isComplete whether every page stylesheet could be read, without which any
 *   part might be set anywhere
 * @property {Set<string>} readNames each custom property a declaration that stacks a part reads,
 *   itself or through another custom property
 */

/**
 * The indexes of each of `marks` in CSS that lie outside its strings, parentheses, and brackets.
 * @param {string} text
 * @param {string} marks
 */
function findTopLevelMarks(text, marks) {
  const found = [];
  let quote = "";
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (quote) {
      if (character === "\\") at += 1;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (depth === 0 && marks.includes(character)) found.push(at);
  }
  return found;
}

/**
 * CSS cut at each `separator` outside its strings, parentheses, and brackets, with each part
 * trimmed and the empty ones left out.
 * @param {string} text
 * @param {string} separator
 */
function splitTopLevel(text, separator) {
  const ends = [...findTopLevelMarks(text, separator), text.length];
  return ends
    .map((end, index) => text.slice(index ? ends[index - 1] + 1 : 0, end).trim())
    .filter(Boolean);
}

/**
 * The simple selectors of the part a selector styles: its last compound, without its attribute
 * selectors, pseudo-classes, and pseudo-elements, with whether it's nested on its parent's.
 * @param {string} selector
 */
function readSubject(selector) {
  const last = selector.slice((findTopLevelMarks(selector, " >+~").at(-1) ?? -1) + 1);
  let compound = last.replace(/\[[^\]]*\]/g, "");
  for (let previous = ""; previous !== compound;) {
    previous = compound;
    compound = compound.replace(/::?[\w-]+\([^()]*\)/g, "");
  }
  compound = compound.replace(/::?[\w-]+/g, "");
  return { simple: compound.match(/[.#]?-?[_a-zA-Z][\w-]*/g) ?? [], isNested: last.includes("&") };
}

/**
 * The simple selectors of the part each selector of the innermost rule in `context` styles, with
 * a nested selector's parts taken from its parent's.
 * @param {string[]} context the at-rules and selectors around the rule, from the outside in
 */
function listSubjects(context) {
  /** @type {string[][] | null} */
  let subjects = null;
  for (const prelude of context.filter((rule) => !rule.startsWith("@"))) {
    const parents = subjects;
    subjects = splitTopLevel(prelude, ",").flatMap((selector) => {
      const { simple, isNested } = readSubject(selector);
      if (!isNested || !parents) return [simple];
      return parents.map((parent) => (parent.length ? [...parent, ...simple] : []));
    });
  }
  return subjects ?? [[]];
}

/** @param {string} text */
function readDeclaration(text) {
  const [property, ...value] = text.split(":");
  const name = property.trim();
  return {
    property: name.startsWith("--") ? name : name.toLowerCase(),
    value: value.join(":").trim(),
  };
}

/**
 * @param {string[]} context the at-rules and selectors around the rule, from the outside in
 * @param {Declaration[]} declarations
 * @returns {StyleRule}
 */
function createStyleRule(context, declarations) {
  const prelude = context.at(-1) ?? "";
  const around = context.slice(0, -1);
  const selectors = prelude.startsWith("@") ? [prelude] : splitTopLevel(prelude, ",");
  return {
    reaches: selectors.map((selector) => [...around, selector].join(" ")),
    subjects: listSubjects(context),
    declarations,
    isKeyframe: around.some((rule) => /^@(?:-webkit-)?keyframes\b/i.test(rule)),
  };
}

/**
 * A stylesheet's top-level statements and rules, as esbuild reads it without its comments and
 * formatting, in its order but with each rule placed where its block closes, so a nested rule comes
 * before the one around it, or null when it can't be read, as with a brace that closes nothing.
 * @param {string} sheet
 * @returns {StyleItem[] | null}
 */
function readStyleSheet(sheet) {
  let code;
  try {
    code = transformSync(sheet, {
      loader: "css",
      legalComments: "none",
      minifyWhitespace: true,
    }).code;
  } catch {
    return null;
  }
  /** @type {StyleItem[]} */
  const items = [];
  /** @type {string[]} */
  const context = [];
  /** @type {Declaration[][]} */
  const openBlocks = [[]];
  let start = 0;
  for (const at of findTopLevelMarks(code, "{;}")) {
    const text = code.slice(start, at).trim();
    start = at + 1;
    if (code[at] === "{") {
      context.push(text);
      openBlocks.push([]);
      continue;
    }
    if (openBlocks.length === 1) {
      if (code[at] === "}") return null;
      if (text) items.push({ statement: text });
      continue;
    }
    const declarations = /** @type {Declaration[]} */ (openBlocks.at(-1));
    if (text) declarations.push(readDeclaration(text));
    if (code[at] !== "}") continue;
    if (declarations.length) items.push(createStyleRule(context, declarations));
    context.pop();
    openBlocks.pop();
  }
  return openBlocks.length === 1 ? items : null;
}

/** @param {StyleItem} item @returns {item is StyleRule} */
const isStyleRule = (item) => !("statement" in item);

/** @param {string} property */
const readBareName = (property) => property.replace(/^-webkit-/, "");

/**
 * Whether a property is one of `families` or one of their longhands, as overflow-x is overflow's,
 * with or without the -webkit- prefix.
 * @param {string} property
 * @param {string[]} families
 */
function isInFamily(property, families) {
  const name = readBareName(property);
  return families.some((family) => name === family || name.startsWith(`${family}-`));
}

/** @param {Declaration} declaration */
const readValue = ({ value }) => value.replace(/\s*!important$/i, "");

/**
 * Whether a declaration's value reads a custom property, which can hold any value at all.
 * @param {Declaration} declaration
 */
const hasVariable = ({ value }) => /var\(/i.test(value);

/** @param {Declaration} declaration */
const listVariables = ({ value }) =>
  [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);

/**
 * The property an item of a transition's list eases, or all of them when it names none.
 * @param {string} item
 */
const readTransitionedProperty = (item) =>
  splitTopLevel(item, " ").find((part) => !TRANSITION_TIMING.test(part)) ?? "all";

/**
 * The properties a rule's transitions ease, which are all of them when it times a transition
 * without naming what it eases.
 * @param {Declaration[]} declarations
 */
function listTransitioned(declarations) {
  const named = declarations.flatMap(({ property, value }) => {
    const name = readBareName(property);
    if (name === "transition") return splitTopLevel(value, ",").map(readTransitionedProperty);
    return name === "transition-property" ? splitTopLevel(value, ",") : [];
  });
  const isTimed = declarations.some(({ property }) => isInFamily(property, ["transition"]));
  return named.length || !isTimed ? named : ["all"];
}

/**
 * Whether a transition that eases `name` can move, fade, or show a part: all of them, one that
 * stacks a part, or a keyword that takes the transition from somewhere else.
 * @param {string} name
 */
const isMovingName = (name) =>
  /^all$/i.test(name) ||
  CSS_WIDE_KEYWORD.test(name) ||
  isInFamily(name.toLowerCase(), STACK_PROPERTIES);

/**
 * Whether a rule's transitions move, fade, or show a part, rather than only recolor it.
 * @param {Declaration[]} declarations
 */
const isTransitionMoving = (declarations) =>
  declarations.some(
    (declaration) => isInFamily(declaration.property, ["transition"]) && hasVariable(declaration),
  ) || listTransitioned(declarations).some(isMovingName);

/**
 * Whether a rule moves what it reaches: a step of keyframes, an animation, a will-change, or a
 * transition that moves.
 * @param {StyleRule} rule
 */
const isMovingRule = ({ declarations, isKeyframe }) =>
  isKeyframe ||
  declarations.some(({ property }) => isInFamily(property, ["animation", "will-change"])) ||
  isTransitionMoving(declarations);

/**
 * Whether a rule hides a part with its display, or might.
 * @param {StyleRule} rule
 */
const isHidingRule = ({ declarations }) =>
  declarations.some(
    (declaration) =>
      readBareName(declaration.property) === "display" &&
      (hasVariable(declaration) || HIDING_DISPLAY.test(readValue(declaration))),
  );

/**
 * Whether a rule stacks a part: a z-index, or a position that takes it out of the flow, or might.
 * @param {StyleRule} rule
 */
const isStackingRule = ({ declarations }) =>
  declarations.some((declaration) => {
    const name = readBareName(declaration.property);
    if (name === "z-index") return true;
    return (
      name === "position" &&
      (hasVariable(declaration) || !IN_FLOW_POSITION.test(readValue(declaration)))
    );
  });

/**
 * Each custom property the declarations that stack a part read, and each one those read in turn.
 * @param {StyleRule[]} rules
 */
function listReadNames(rules) {
  const declarations = rules.flatMap((rule) => rule.declarations);
  const names = new Set(
    declarations
      .filter(({ property }) => isInFamily(property, STACK_PROPERTIES))
      .flatMap(listVariables),
  );
  for (let size = -1; size !== names.size;) {
    size = names.size;
    for (const declaration of declarations)
      if (names.has(declaration.property))
        for (const name of listVariables(declaration)) names.add(name);
  }
  return names;
}

/**
 * What every page stylesheet sets for each part, from the stylesheets as `sheets` has them, with
 * null for one that can't be read.
 * @param {(StyleItem[] | null)[]} sheets
 * @returns {StyleIndex}
 */
function createStyleIndex(sheets) {
  const rules = sheets.flatMap((sheet) => sheet ?? []).filter(isStyleRule);
  return {
    rules: rules
      .filter((rule) => !rule.isKeyframe)
      .map((rule) => ({
        subjects: rule.subjects,
        isMoving: isMovingRule(rule),
        isStacking: isStackingRule(rule),
        hidesDisplay: isHidingRule(rule),
      })),
    readNames: listReadNames(rules),
    isComplete: !sheets.includes(null),
  };
}

/**
 * Whether the simple selectors of two parts could be one part's: one holds all of the other's.
 * @param {string[]} first
 * @param {string[]} second
 */
const isSameSubject = (first, second) =>
  first.every((simple) => second.includes(simple)) ||
  second.every((simple) => first.includes(simple));

/**
 * Whether any page stylesheet's rule for the part `rule` styles is `flagged`, which an unknown
 * part, or any part while a stylesheet can't be read, always is.
 * @param {StyleIndex} index
 * @param {StyleRule} rule
 * @param {"isMoving" | "isStacking" | "hidesDisplay"} flagged
 */
const isSetForSubject = (index, rule, flagged) =>
  !index.isComplete ||
  rule.subjects.some(
    (subject) =>
      !subject.length ||
      index.rules.some(
        (other) =>
          other[flagged] &&
          other.subjects.some((part) => part.length && isSameSubject(subject, part)),
      ),
  );

/**
 * Whether a transform, translate, rotate, or scale declaration stays in two dimensions.
 * @param {Declaration} declaration
 */
function isFlatTransform(declaration) {
  if (hasVariable(declaration)) return false;
  const name = readBareName(declaration.property);
  const value = readValue(declaration);
  const parts = splitTopLevel(value, " ");
  if (name === "transform")
    return (
      value.toLowerCase() === "none" || parts.every((part) => FLAT_TRANSFORM_FUNCTION.test(part))
    );
  const most = FLAT_TRANSFORM_VALUES.get(name);
  return most !== undefined && parts.length <= most;
}

/**
 * Whether a declaration gives a part a layer of its own: any of the layer properties, but a
 * transition only when it moves something, and a transform in two dimensions only where its
 * own rule, or any page stylesheet's rule for the same part, moves it, since WebKit composites
 * only a transform in three dimensions or on the move.
 * @param {Declaration} declaration
 * @param {StyleRule} rule
 * @param {StyleIndex} index
 */
function isLayerDeclaration(declaration, rule, index) {
  const name = readBareName(declaration.property);
  if (isInFamily(name, ["transition"])) return isTransitionMoving(rule.declarations);
  if (name === "transform" || FLAT_TRANSFORM_VALUES.has(name))
    return (
      !isFlatTransform(declaration) ||
      isMovingRule(rule) ||
      isSetForSubject(index, rule, "isMoving")
    );
  return isInFamily(name, LAYER_PROPERTIES);
}

/**
 * Whether a declaration in a shared stylesheet decides how iOS layers, stacks, scrolls, or shows a
 * part: any of the stack properties, and any that reads a custom property, but a display only
 * where it or a rule for the same part hides it, and a relative or static position only where a
 * rule for the same part sets a z-index or takes it out of the flow, which it stacks or undoes.
 * @param {Declaration} declaration
 * @param {StyleRule} rule
 * @param {StyleIndex} index
 */
function isStackDeclaration(declaration, rule, index) {
  if (!isInFamily(declaration.property, STACK_PROPERTIES)) return false;
  if (hasVariable(declaration)) return true;
  const name = readBareName(declaration.property);
  const value = readValue(declaration);
  if (name === "display")
    return HIDING_DISPLAY.test(value) || isSetForSubject(index, rule, "hidesDisplay");
  if (name === "position")
    return !IN_FLOW_POSITION.test(value) || isSetForSubject(index, rule, "isStacking");
  return !isInFamily(name, LAYER_PROPERTIES) || isLayerDeclaration(declaration, rule, index);
}

/**
 * Whether a property in any other stylesheet of a page can give a part a layer of its own, lift
 * it over others, or make it scroll.
 * @param {string} property
 */
const isPageLayerProperty = (property) => {
  const name = readBareName(property);
  return (
    ["position", "z-index", "overflow-scrolling"].includes(name) ||
    OVERFLOW_AXES.test(name) ||
    isInFamily(name, LAYER_PROPERTIES)
  );
};

/**
 * Whether a declaration in any other stylesheet of a page gives a part a layer of its own, lifts
 * it over others, or makes it scroll: a fixed, sticky, or absolute position, a z-index, an
 * overflow that isn't visible, touch scrolling, or one that reads a custom property.
 * @param {Declaration} declaration
 * @param {StyleRule} rule
 * @param {StyleIndex} index
 */
function isPageLayerDeclaration(declaration, rule, index) {
  if (!isPageLayerProperty(declaration.property)) return false;
  if (hasVariable(declaration)) return true;
  const name = readBareName(declaration.property);
  const value = readValue(declaration);
  if (name === "position") return /^(?:fixed|sticky|-webkit-sticky|absolute)$/i.test(value);
  if (OVERFLOW_AXES.test(name)) return !/^visible$/i.test(value);
  return (
    name === "z-index" ||
    name === "overflow-scrolling" ||
    isLayerDeclaration(declaration, rule, index)
  );
}

/**
 * @param {string} reach
 * @param {Declaration} declaration
 */
const describeDeclaration = (reach, { property, value }) => `${reach} { ${property}: ${value} }`;

/**
 * A shared stylesheet's top-level statements and the declarations that decide how parts layer,
 * stack, scroll, or show, with the custom properties those read, in the order readStyleSheet
 * reads them, under each selector they reach, as `@media (min-width:780px) .tabs { position: sticky }`.
 * @param {StyleItem[]} items
 * @param {StyleIndex} index
 */
const listStackEntries = (items, index) =>
  items.flatMap((item) => {
    if (!isStyleRule(item)) return [item.statement];
    const kept = item.declarations.filter(
      (declaration) =>
        isStackDeclaration(declaration, item, index) || index.readNames.has(declaration.property),
    );
    return item.reaches.flatMap((reach) =>
      kept.map((declaration) => describeDeclaration(reach, declaration)),
    );
  });

/**
 * @typedef {object} PageEntry
 * @property {string} text
 * @property {boolean} makesLayer whether adding it gives a part a layer, a stack, or a scroll
 * @property {boolean} isWatched whether any change to it is red: a top-level statement, or a
 *   custom property a declaration that stacks a part reads
 * @property {string} property the property it sets, or nothing for a statement
 * @property {string[][]} subjects
 */

/**
 * Any other page stylesheet's top-level statements, its declarations of the properties that can
 * give a part a layer, a stack, or a scroll, whatever their values, and the custom properties
 * those read, in the order readStyleSheet reads them.
 * @param {StyleItem[]} items
 * @param {StyleIndex} index
 * @returns {PageEntry[]}
 */
const listPageEntries = (items, index) =>
  items.flatMap((item) => {
    if (!isStyleRule(item))
      return [
        { text: item.statement, makesLayer: true, isWatched: true, property: "", subjects: [] },
      ];
    return item.reaches.flatMap((reach) =>
      item.declarations
        .filter(({ property }) => isPageLayerProperty(property) || index.readNames.has(property))
        .map((declaration) => {
          const isWatched = index.readNames.has(declaration.property);
          return {
            text: describeDeclaration(reach, declaration),
            makesLayer: isWatched || isPageLayerDeclaration(declaration, item, index),
            isWatched,
            property: readBareName(declaration.property),
            subjects: item.subjects,
          };
        }),
    );
  });

/**
 * Whether two properties set the same thing, as a property and its longhand do.
 * @param {string} first
 * @param {string} second
 */
const isSameProperty = (first, second) =>
  first === second || first.startsWith(`${second}-`) || second.startsWith(`${first}-`);

/** @param {string} path */
const describeUnreadable = (path) =>
  `${path} changes in a way the gate can't read, so it may change anything`;

/**
 * Why a change to a shared stylesheet is red: each statement, and each declaration that decides
 * how parts layer, stack, scroll, or show, that a selector gains, loses, or reads in another
 * order. Only a change that leaves that sequence as it was isn't red, like a selector renamed that
 * sets none of them, or a selector list split into rules in its order, with nothing that counts
 * between them.
 * @param {string} path
 * @param {{ before: StyleItem[], after: StyleItem[] } | null} sides
 * @param {StyleIndex} index
 */
function findSharedStyleReasons(path, sides, index) {
  if (!sides) return [describeUnreadable(path)];
  const before = listStackEntries(sides.before, index);
  const after = listStackEntries(sides.after, index);
  const changes = `${path} changes how parts layer, stack, scroll, or show:`;
  const reasons = [
    ...subtractEach(after, before).map((entry) => `${changes} adds ${entry}`),
    ...subtractEach(before, after).map((entry) => `${changes} drops ${entry}`),
  ];
  if (reasons.length || isSharedOrderKept(before, after)) return reasons;
  return [`${changes} reorders ${after.find((entry, at) => entry !== before[at])}`];
}

/**
 * Why a change to any other stylesheet of a page is red: an entry it adds that gives a part a
 * layer, a stack, or a scroll; one it takes out that's watched, or that sets a property an entry
 * it leaves for the same part, or a part that can't be told, also sets, which it may have
 * overridden; and entries it keeps but reads in another order.
 * @param {string} path
 * @param {{ before: StyleItem[], after: StyleItem[] } | null} sides
 * @param {StyleIndex} index
 */
function findPageStyleReasons(path, sides, index) {
  if (!sides) return [describeUnreadable(path)];
  const before = listPageEntries(sides.before, index);
  const after = listPageEntries(sides.after, index);
  /** @param {PageEntry} entry */
  const readText = (entry) => entry.text;
  const layersLeft = after.filter((entry) => entry.makesLayer);
  /** @param {PageEntry} entry */
  const isOverride = (entry) =>
    layersLeft.some(
      (layer) =>
        isSameProperty(entry.property, layer.property) &&
        entry.subjects.some((subject) =>
          layer.subjects.some(
            (part) => !subject.length || !part.length || isSameSubject(subject, part),
          ),
        ),
    );
  const reasons = [
    ...subtractEach(after, before, readText)
      .filter((entry) => entry.makesLayer)
      .map(({ text }) => `${path} adds a layer, a stack, or a scroll: ${text}`),
    ...subtractEach(before, after, readText)
      .filter((entry) => entry.isWatched || isOverride(entry))
      .map(({ text }) => `${path} drops what decides a layer, a stack, or a scroll: ${text}`),
  ];
  if (isSharedOrderKept(before, after, readText)) return reasons;
  return [...reasons, `${path} reorders what decides a layer, a stack, or a scroll`];
}

/**
 * A changed stylesheet before the change and after it, or null when either can't be read.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 */
function readStyleSides(file, readPageFile) {
  const sides = readBothSides(file, readPageFile);
  const before = sides && readStyleSheet(sides.before);
  const after = sides && readStyleSheet(sides.after);
  return before && after ? { before, after } : null;
}

/**
 * Why each changed stylesheet of a page is red, judged against what every page stylesheet sets:
 * those the change leaves as they are, and each changed one before the change and after it.
 * @param {ChangedFile[]} stylesheets the page stylesheets the change touches
 * @param {object} options
 * @param {(path: string) => boolean} options.isShared whether a stylesheet moves and draws the page
 * @param {ReadPageFile} options.readPageFile
 * @param {() => string[]} options.listStylesheets every page stylesheet
 * @returns {Map<ChangedFile, string[]>}
 */
export function findStyleReasons(stylesheets, { isShared, readPageFile, listStylesheets }) {
  if (!stylesheets.length) return new Map();
  const sides = new Map(stylesheets.map((file) => [file, readStyleSides(file, readPageFile)]));
  const changedPaths = new Set(stylesheets.map(({ path }) => path));
  const unchanged = listStylesheets()
    .filter((path) => !changedPaths.has(path))
    .map((path) => readStyleSheet(readPageFile(path)));
  const changed = [...sides.values()].flatMap((side) =>
    side ? [side.before, side.after] : [null],
  );
  const index = createStyleIndex([...unchanged, ...changed]);
  return new Map(
    stylesheets.map((file) => {
      if (!isShared(file.path))
        return [file, findPageStyleReasons(file.path, sides.get(file), index)];
      const side = file.hunks.length ? sides.get(file) : null;
      return [file, findSharedStyleReasons(file.path, side, index)];
    }),
  );
}
