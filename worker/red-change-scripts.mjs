// Which of the shared scripts that move and draw the page a change changes the code of, for
// worker/red-change.mjs: beyond their comments and formatting, and a declaration moved unchanged
// from one of them to another, read with esbuild and acorn.
import { posix } from "node:path";
import { parse } from "acorn";
import { transformSync } from "esbuild";
import { isSharedOrderKept, readBothSides, subtractEach } from "./changed-files.mjs";

/** @typedef {import("./changed-files.mjs").ChangedFile} ChangedFile */
/** @typedef {import("./changed-files.mjs").ReadPageFile} ReadPageFile */

/**
 * @typedef {object} TopLevelStatement
 * @property {string} code as esbuild prints it without comments or formatting
 * @property {boolean} isHoisted a function declaration, which runs nothing where it stands
 * @property {boolean} isMovable a declaration whose evaluation does nothing else: a function, or a
 *   variable set to a function, a literal, or nothing
 * @property {string[]} names what it declares
 * @property {string[]} uses every name in it, read or declared, but property names
 */
/**
 * @typedef {object} ScriptLink an import or export, as `import shared/page/x.js#name->local`
 * @property {string} text
 * @property {"import" | "export"} kind
 * @property {string} source the module it imports from or exports from, if any
 * @property {string} imported
 * @property {string} local
 */
/**
 * @typedef {object} ScriptCode
 * @property {TopLevelStatement[]} statements leaving out imports and exports, and `export` taken
 *   off what it exports
 * @property {ScriptLink[]} links
 * @property {string[]} sources each module it imports from, in its order
 * @property {Set<string>} bindings each name its top level declares or imports
 */
/** @typedef {{ before: ScriptCode, after: ScriptCode }} ScriptSides */
/** @typedef {{ statement: TopLevelStatement, from: Set<string>, to: Set<string> }} Move */

/**
 * A script's code with its comments, blank lines, and formatting taken out, as esbuild parses it,
 * or null when it doesn't parse.
 * @param {string} script
 */
function readScriptCode(script) {
  try {
    return transformSync(script, { loader: "js", legalComments: "none", minifyWhitespace: true })
      .code;
  } catch {
    return null;
  }
}

/**
 * Whether `node` names a property after a dot, or keys an object or a class, which names no
 * binding.
 * @param {any} node
 * @param {any} parent
 * @param {string} key
 */
const isPropertyName = (node, parent, key) =>
  node.type === "Identifier" &&
  parent &&
  !parent.computed &&
  ((parent.type === "MemberExpression" && key === "property") ||
    (["Property", "MethodDefinition", "PropertyDefinition"].includes(parent.type) &&
      key === "key" &&
      !parent.shorthand));

/**
 * Every name a node reads or declares, but property names.
 * @param {any} node
 */
function listNames(node) {
  /** @type {string[]} */
  const names = [];
  /** @param {any} value @param {any} parent @param {string} key */
  const visit = (value, parent, key) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parent, key);
      return;
    }
    if (!value || typeof value.type !== "string" || isPropertyName(value, parent, key)) return;
    if (value.type === "Identifier") names.push(value.name);
    for (const [childKey, child] of Object.entries(value))
      if (child && typeof child === "object") visit(child, value, childKey);
  };
  visit(node, null, "");
  return names;
}

/** @param {any} node */
const listDeclaredNames = (node) => {
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration")
    return [node.id.name];
  if (node.type === "VariableDeclaration")
    return node.declarations.flatMap((/** @type {any} */ declarator) => listNames(declarator.id));
  return [];
};

/** @param {any} value */
const isQuietValue = (value) =>
  !value ||
  ["ArrowFunctionExpression", "FunctionExpression", "Literal"].includes(value.type) ||
  (value.type === "TemplateLiteral" && !value.expressions.length);

/** @param {any} node */
const isMovable = (node) =>
  node.type === "FunctionDeclaration" ||
  (node.type === "VariableDeclaration" &&
    node.declarations.every(
      (/** @type {any} */ declarator) =>
        declarator.id.type === "Identifier" && isQuietValue(declarator.init),
    ));

/** @param {any} name an identifier, or a string a module names an import or export by */
const readName = (name) => String(name.name ?? name.value);

/**
 * The module an import or export statement names, from the repository's root when it's a path,
 * or nothing when it names none.
 * @param {any} statement
 * @param {string} path the script that holds it
 */
const readSource = (statement, path) => {
  const specifier = statement.source ? String(statement.source.value) : "";
  return specifier.startsWith(".") ? posix.join(posix.dirname(path), specifier) : specifier;
};

/**
 * Each import and export a top-level statement of a script makes, from the script at `path`.
 * @param {any} statement
 * @param {string} path
 * @returns {ScriptLink[]}
 */
function listLinks(statement, path) {
  const source = readSource(statement, path);
  /** @param {"import" | "export"} kind @param {string} imported @param {string} local */
  const link = (kind, imported, local) => ({
    text: `${kind} ${source}#${imported}->${local}`,
    kind,
    source,
    imported,
    local,
  });
  if (statement.type === "ImportDeclaration") {
    if (!statement.specifiers.length) return [link("import", "", "")];
    return statement.specifiers.map((/** @type {any} */ part) => {
      if (part.type === "ImportDefaultSpecifier") return link("import", "default", part.local.name);
      if (part.type === "ImportNamespaceSpecifier") return link("import", "*", part.local.name);
      return link("import", readName(part.imported), part.local.name);
    });
  }
  if (statement.type === "ExportAllDeclaration")
    return [link("export", "*", statement.exported ? readName(statement.exported) : "")];
  if (statement.declaration)
    return listDeclaredNames(statement.declaration).map((name) => link("export", name, name));
  return statement.specifiers.map((/** @type {any} */ part) =>
    link("export", readName(part.local), readName(part.exported)),
  );
}

/**
 * @param {any} node
 * @param {string} code the script's code the node was parsed from
 * @returns {TopLevelStatement}
 */
const readStatement = (node, code) => ({
  code: code.slice(node.start, node.end).replace(/;$/, ""),
  isHoisted: node.type === "FunctionDeclaration",
  isMovable: isMovable(node),
  names: listDeclaredNames(node),
  uses: listNames(node),
});

/**
 * A script's top-level code, its imports and exports, the modules it imports from, and the names
 * its top level binds, or null when it doesn't parse.
 * @param {string} script
 * @param {string} path from the repository's root
 * @returns {ScriptCode | null}
 */
function readTopLevelCode(script, path) {
  const code = readScriptCode(script);
  if (code === null) return null;
  let program;
  try {
    program = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return null;
  }
  /** @type {ScriptCode} */
  const read = { statements: [], links: [], sources: [], bindings: new Set() };
  for (const statement of /** @type {any[]} */ (program.body)) {
    const isLink = ["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].includes(
      statement.type,
    );
    const declaration = isLink ? statement.declaration : statement;
    if (declaration) read.statements.push(readStatement(declaration, code));
    if (!isLink) continue;
    const links = listLinks(statement, path);
    read.links.push(...links);
    if (statement.type === "ImportDeclaration")
      for (const { local } of links) if (local) read.bindings.add(local);
    const source = readSource(statement, path);
    if (source && !read.sources.includes(source)) read.sources.push(source);
  }
  for (const { names } of read.statements) for (const name of names) read.bindings.add(name);
  return read;
}

/**
 * A changed script's top-level code before the change and after it, or null when it's gone, its
 * hunks don't fit it, or either side doesn't parse.
 * @param {ChangedFile} file
 * @param {ReadPageFile} readPageFile
 * @returns {ScriptSides | null}
 */
function readScriptSides(file, readPageFile) {
  const sides = file.hunks.length ? readBothSides(file, readPageFile) : null;
  if (!sides?.after) return null;
  const before = readTopLevelCode(sides.before, file.path);
  const after = readTopLevelCode(sides.after, file.path);
  return before && after ? { before, after } : null;
}

/** @param {TopLevelStatement} statement */
const readCode = (statement) => statement.code;
/** @param {ScriptLink} link */
const readLinkText = (link) => link.text;

/**
 * Each statement that leaves some of the scripts and arrives in others as often, unchanged, with
 * the scripts it leaves and the ones it arrives in.
 * @param {Map<string, ScriptSides>} scripts each script that can be read, by its path
 * @returns {Map<string, Move>}
 */
function findMoves(scripts) {
  const all = [...scripts.values()];
  const before = all.flatMap(({ before: side }) => side.statements.map(readCode));
  const after = all.flatMap(({ after: side }) => side.statements.map(readCode));
  /** @param {string[]} codes @param {string} code */
  const count = (codes, code) => codes.filter((each) => each === code).length;
  /** @type {Map<string, Move>} */
  const moves = new Map();
  for (const [path, sides] of scripts) {
    const gained = subtractEach(sides.after.statements, sides.before.statements, readCode);
    const lost = subtractEach(sides.before.statements, sides.after.statements, readCode);
    for (const [statement, direction] of [
      ...gained.map((each) => /** @type {const} */ ([each, "to"])),
      ...lost.map((each) => /** @type {const} */ ([each, "from"])),
    ]) {
      if (count(before, statement.code) !== count(after, statement.code)) continue;
      const move = moves.get(statement.code) ?? { statement, from: new Set(), to: new Set() };
      move[direction].add(path);
      moves.set(statement.code, move);
    }
  }
  return moves;
}

/**
 * Whether a moved declaration means the same where it arrives: it runs nothing as it's declared,
 * and no name it holds but its own is bound at the top level of any script it leaves or arrives
 * in, before the change or after it, so each one it reads is a global's in both.
 * @param {Move} move
 * @param {Map<string, ScriptSides>} scripts
 */
function isSafeMove({ statement, from, to }, scripts) {
  if (!statement.isMovable) return false;
  const bound = [...from, ...to].flatMap((path) => {
    const { before, after } = /** @type {ScriptSides} */ (scripts.get(path));
    return [...before.bindings, ...after.bindings];
  });
  return statement.uses.every((name) => statement.names.includes(name) || !bound.includes(name));
}

/**
 * Whether an import or export a script gains or loses only follows a declaration that moved: the
 * script it left now imports it from where it went, the script it went to no longer imports it
 * from where it was, and each exports it where it is.
 * @param {ScriptLink} link
 * @param {string} path the script that gains or loses it
 * @param {boolean} isGained
 * @param {Map<string, Set<string>[]>} movedNames each moved name's scripts left and arrived in
 * @param {{ gained: ScriptLink[], lost: ScriptLink[] }} changedLinks
 */
function isLinkFollowingMove(link, path, isGained, movedNames, changedLinks) {
  if (link.imported !== link.local) return false;
  const [from, to] = movedNames.get(link.local) ?? [];
  if (!from) return false;
  if (link.kind === "export") return !link.source && (isGained ? to : from).has(path);
  const [here, there] = isGained ? [from, to] : [to, from];
  const swapped = isGained ? changedLinks.lost : changedLinks.gained;
  return (
    there.has(link.source) &&
    (here.has(path) ||
      swapped.some(
        (other) => other.kind === "import" && other.local === link.local && here.has(other.source),
      ))
  );
}

/**
 * Whether a script's change goes beyond moving declarations among the shared scripts that move
 * and draw the page: code that changed, a statement that moved unsafely or is in another place
 * among those it keeps, an import or export that doesn't follow a move, or its modules imported
 * in another order.
 * @param {string} path
 * @param {ScriptSides} sides
 * @param {Map<string, Move>} safeMoves
 * @param {Map<string, Set<string>[]>} movedNames
 */
function changesScriptCode(path, { before, after }, safeMoves, movedNames) {
  const changed = [
    ...subtractEach(after.statements, before.statements, readCode),
    ...subtractEach(before.statements, after.statements, readCode),
  ];
  if (changed.some(({ code }) => !safeMoves.has(code))) return true;
  /** @param {TopLevelStatement[]} statements */
  const listPlaced = (statements) => statements.filter(({ isHoisted }) => !isHoisted);
  if (!isSharedOrderKept(listPlaced(before.statements), listPlaced(after.statements), readCode))
    return true;
  const changedLinks = {
    gained: subtractEach(after.links, before.links, readLinkText),
    lost: subtractEach(before.links, after.links, readLinkText),
  };
  const isFollowing = (/** @type {boolean} */ isGained) => (/** @type {ScriptLink} */ link) =>
    isLinkFollowingMove(link, path, isGained, movedNames, changedLinks);
  return (
    !changedLinks.gained.every(isFollowing(true)) ||
    !changedLinks.lost.every(isFollowing(false)) ||
    !isSharedOrderKept(before.sources, after.sources)
  );
}

/**
 * The shared scripts that move and draw the page whose change is red: each whose code changes
 * beyond its comments, formatting, and declarations moved unchanged, and safely, among those
 * scripts, and each that's gone, moved, or can't be read.
 * @param {ChangedFile[]} redScripts the shared scripts that move and draw the page that the change
 *   touches
 * @param {ReadPageFile} readPageFile
 */
export function findRedSharedScripts(redScripts, readPageFile) {
  const sides = new Map(redScripts.map((file) => [file, readScriptSides(file, readPageFile)]));
  /** @type {Map<string, ScriptSides>} */
  const scripts = new Map();
  for (const [file, side] of sides) if (side) scripts.set(file.path, side);
  const safeMoves = new Map(
    [...findMoves(scripts)].filter(([, move]) => isSafeMove(move, scripts)),
  );
  /** @type {Map<string, Set<string>[]>} */
  const movedNames = new Map();
  for (const { statement, from, to } of safeMoves.values())
    for (const name of statement.names) movedNames.set(name, [from, to]);
  return new Set(
    redScripts.filter((file) => {
      const side = sides.get(file);
      return !side || changesScriptCode(file.path, side, safeMoves, movedNames);
    }),
  );
}
