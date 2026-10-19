// What a change to a page's stylesheets does to how iOS layers, stacks, scrolls, and shows its
// parts, for worker/red-change.mjs, from each stylesheet as esbuild reads it, without its comments
// and formatting, before and after the change.
import { transformSync } from "esbuild";

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

// Beside the layers, what decides how iOS stacks, scrolls, and shows the page's parts: where a
// part sits over others, what scrolls and takes a touch, whether a part draws at all, and a
// container, whose containment stacks and holds what it contains. Each names its longhands and
// -webkit- copies too, as overflow-x and -webkit-overflow-scrolling are overflow's. Their fonts,
// colors, spacing, and sizes CI checks as an iPhone shows them.
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
  "offset",
  "view-transition-name",
  "box-reflect",
];

// What a page's other stylesheets may set without the phone, since none of them can give a part
// a layer of its own, lift it over others, or make it scroll.
const PAGE_QUIET_PROPERTIES = ["opacity", "visibility", "display"];
const OUT_OF_FLOW_POSITION = /^(?:absolute|fixed|sticky|-webkit-sticky)$/i;
const SCROLLING_OVERFLOW = /^overflow(?:-x|-y|-inline|-block|-scrolling)?$/;

// The properties a transition can ease that only repaint a part, never layer or move it.
const PAINT_ONLY_PROPERTY =
  /^(?:color|background-color|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-color|outline-color|box-shadow|text-decoration-color|fill|stroke|caret-color)$/;
// What a transition's list holds beside the property it eases: its times, its easing, and how it
// treats a property that can't ease.
const TRANSITION_TIMING =
  /^(?:-?[\d.]+m?s|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete)$|\(/i;

/** @typedef {{ property: string, value: string }} Declaration */
/**
 * @typedef {object} StyleRule
 * @property {string[]} reaches each selector the rule reaches, after the at-rules and selectors
 *   around it
 * @property {Declaration[]} declarations
 */
/** @typedef {{ statement: string }} StyleStatement a top-level statement, like `@layer a,b` */
/** @typedef {StyleRule | StyleStatement} StyleItem */
/**
 * @typedef {object} ChangedStylesheet
 * @property {string} path
 * @property {boolean} isShared whether it's one of the shared stylesheets that move and draw the
 *   page
 * @property {{ before: string, after: string } | null} sides the stylesheet before the change and
 *   after it, or null when the change can't be fitted to it
 */
/** @typedef {{ text: string, isWatched: boolean }} StyleEntry */

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
  return { reaches: selectors.map((selector) => [...around, selector].join(" ")), declarations };
}

/**
 * A stylesheet's top-level statements and rules, as esbuild reads it, in its order but with each
 * rule placed where its block closes, so a nested rule comes before the one around it, or null
 * when it can't be read, as with a brace that closes nothing.
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
 * Whether a property is one of `families` or one of their longhands, with or without the -webkit-
 * prefix.
 * @param {string} property
 * @param {string[]} families
 */
function isInFamily(property, families) {
  const name = readBareName(property);
  return families.some((family) => name === family || name.startsWith(`${family}-`));
}

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
 * Whether a declaration is a transition, or the list of what transitions ease, that names only
 * properties that repaint a part.
 * @param {Declaration} declaration
 */
function isPaintOnlyTransition(declaration) {
  const name = readBareName(declaration.property);
  if (!["transition", "transition-property"].includes(name) || hasVariable(declaration))
    return false;
  const items = splitTopLevel(declaration.value, ",");
  const eased = name === "transition" ? items.map(readTransitionedProperty) : items;
  return eased.every((property) => PAINT_ONLY_PROPERTY.test(property.toLowerCase()));
}

/**
 * Whether a declaration in a shared stylesheet decides how parts layer, stack, scroll, or show,
 * whatever its value, but for a transition of colors and shadows alone.
 * @param {Declaration} declaration
 */
const isStackDeclaration = (declaration) =>
  isInFamily(declaration.property, STACK_PROPERTIES) && !isPaintOnlyTransition(declaration);

/**
 * Whether a declaration in any other stylesheet of a page can give a part a layer of its own, lift
 * it over others, or make it scroll: a stack property but opacity, visibility, and display, with a
 * position only out of the flow and an overflow only when it isn't visible, unless it reads a
 * custom property.
 * @param {Declaration} declaration
 */
function isPageLayerDeclaration(declaration) {
  const name = readBareName(declaration.property);
  if (!isStackDeclaration(declaration) || isInFamily(name, PAGE_QUIET_PROPERTIES)) return false;
  if (hasVariable(declaration)) return true;
  const value = declaration.value.replace(/\s*!important$/i, "");
  if (name === "position") return OUT_OF_FLOW_POSITION.test(value);
  if (name.startsWith("overflow"))
    return SCROLLING_OVERFLOW.test(name) && !/^visible$/i.test(value);
  return true;
}

/**
 * Each custom property the stack declarations of `rules` read, and each one those read in turn.
 * @param {StyleRule[]} rules
 */
function listReadNames(rules) {
  const declarations = rules.flatMap((rule) => rule.declarations);
  const names = new Set(declarations.filter(isStackDeclaration).flatMap(listVariables));
  for (let size = -1; size !== names.size;) {
    size = names.size;
    for (const declaration of declarations)
      if (names.has(declaration.property))
        for (const name of listVariables(declaration)) names.add(name);
  }
  return names;
}

/**
 * @param {string} reach
 * @param {Declaration} declaration
 */
const describeDeclaration = (reach, { property, value }) => `${reach} { ${property}: ${value} }`;

/**
 * Each top-level statement of a stylesheet, and each of its declarations that `isKept` keeps,
 * under each selector it reaches, as `@media (min-width:780px) .tabs { position: sticky }`, in the
 * order readStyleSheet reads them, with whether it's a statement or a watched custom property,
 * which any change to makes red.
 * @param {StyleItem[]} items
 * @param {(declaration: Declaration) => boolean} isKept
 * @param {(property: string) => boolean} isWatched
 * @returns {StyleEntry[]}
 */
const listEntries = (items, isKept, isWatched) =>
  items.flatMap((item) => {
    if (!isStyleRule(item)) return [{ text: item.statement, isWatched: true }];
    const kept = item.declarations.filter(
      (declaration) => isKept(declaration) || isWatched(declaration.property),
    );
    return item.reaches.flatMap((reach) =>
      kept.map((declaration) => ({
        text: describeDeclaration(reach, declaration),
        isWatched: isWatched(declaration.property),
      })),
    );
  });

/**
 * The texts of `entries` that `taken` doesn't account for, each of `taken` taking one copy away.
 * @param {StyleEntry[]} entries
 * @param {StyleEntry[]} taken
 */
function subtractEach(entries, taken) {
  const counts = new Map();
  for (const { text } of taken) counts.set(text, (counts.get(text) ?? 0) + 1);
  return entries.filter(({ text }) => {
    const count = counts.get(text) ?? 0;
    counts.set(text, count - 1);
    return count <= 0;
  });
}

/**
 * Why a changed file the gate can't read before the change and after it is red.
 * @param {string} path
 */
export const describeUnreadable = (path) =>
  `${path} changes in a way the gate can't read, so it may change anything`;

/**
 * Why a change to a shared stylesheet that moves and draws the page is red: each statement, each
 * declaration that decides how parts layer, stack, scroll, or show, and each custom property one
 * of those reads, that a selector gains, loses, or holds in another order. A selector renamed, or a
 * rule split or merged, that sets none of them leaves that sequence as it was, and so does a
 * selector list split into a rule for each selector in its order, so neither is red.
 * @param {string} path
 * @param {{ before: StyleItem[], after: StyleItem[] }} sheets
 * @param {(property: string) => boolean} isWatched
 */
function findSharedStyleReasons(path, sheets, isWatched) {
  const before = listEntries(sheets.before, isStackDeclaration, isWatched);
  const after = listEntries(sheets.after, isStackDeclaration, isWatched);
  const changes = `${path} changes how parts layer, stack, scroll, or show:`;
  const reasons = [
    ...subtractEach(after, before).map(({ text }) => `${changes} adds ${text}`),
    ...subtractEach(before, after).map(({ text }) => `${changes} drops ${text}`),
  ];
  const reordered = after.find((entry, at) => entry.text !== before[at]?.text);
  if (reasons.length || !reordered) return reasons;
  return [`${changes} reorders ${reordered.text}`];
}

/**
 * Why a change to any other stylesheet of a page is red: each declaration it adds that gives a
 * part a layer of its own, lifts it over others, or makes it scroll, and each top-level statement
 * or watched custom property it adds, takes out, or changes.
 * @param {string} path
 * @param {{ before: StyleItem[], after: StyleItem[] }} sheets
 * @param {(property: string) => boolean} isWatched
 */
function findPageStyleReasons(path, sheets, isWatched) {
  const before = listEntries(sheets.before, isPageLayerDeclaration, isWatched);
  const after = listEntries(sheets.after, isPageLayerDeclaration, isWatched);
  return [
    ...subtractEach(after, before).map(
      ({ text }) => `${path} adds a layer, a stack, or a scroll: ${text}`,
    ),
    ...subtractEach(before, after)
      .filter((entry) => entry.isWatched)
      .map(({ text }) => `${path} drops what decides a layer, a stack, or a scroll: ${text}`),
  ];
}

/**
 * Why each changed stylesheet of a page is red, with the custom properties that every page
 * stylesheet's stack declarations read watched, before the change and after it, or every one of
 * them when a stylesheet can't be read.
 * @param {ChangedStylesheet[]} changed
 * @param {string[]} unchanged every other stylesheet of a page
 * @returns {Map<string, string[]>} the reasons, by each changed stylesheet's path
 */
export function findStyleReasons(changed, unchanged) {
  const read = changed.map(({ path, isShared, sides }) => {
    const before = sides && readStyleSheet(sides.before);
    const after = sides && readStyleSheet(sides.after);
    return { path, isShared, sheets: before && after ? { before, after } : null };
  });
  const sheets = [
    ...unchanged.map(readStyleSheet),
    ...read.flatMap(({ sheets: both }) => (both ? [both.before, both.after] : [null])),
  ];
  const readNames = sheets.includes(null)
    ? null
    : listReadNames(sheets.flatMap((items) => items ?? []).filter(isStyleRule));
  /** @param {string} property */
  const isWatched = (property) =>
    property.startsWith("--") && (readNames === null || readNames.has(property));
  return new Map(
    read.map(({ path, isShared, sheets: both }) => {
      if (!both) return [path, [describeUnreadable(path)]];
      const findReasons = isShared ? findSharedStyleReasons : findPageStyleReasons;
      return [path, findReasons(path, both, isWatched)];
    }),
  );
}
