// Reads the scoped rule files in .claude/rules/, which Claude Code loads once a session reads or
// edits a file one of their `paths` globs matches, so a file's rules are known without a session.

export const RULES_FOLDER = ".claude/rules/";

/**
 * Whether a path is a rule file.
 * @param {string} path
 */
export const isRuleFile = (path) => path.startsWith(RULES_FOLDER) && path.endsWith(".md");

/**
 * Each rule file among the repo's files, with its text.
 * @param {string[]} repoFiles
 * @param {(path: string) => string} readFile
 */
export const readRuleFiles = (repoFiles, readFile) =>
  repoFiles.filter(isRuleFile).map((path) => ({ path, text: readFile(path) }));

/**
 * The `paths` globs a rule file's frontmatter lists, each an item of its own, quoted or not, or
 * none when it has no frontmatter.
 * @param {string} text
 * @returns {string[]}
 */
export function readRulePaths(text) {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1] ?? "";
  return [...frontmatter.matchAll(/^\s+-\s+(["']?)(.+?)\1\s*$/gm)].map((match) => match[2]);
}

/**
 * Text made safe to match word for word in a regular expression.
 * @param {string} text
 */
export const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A glob as a regular expression: `**` matches across folders, and a `**` followed by a slash
 * matches no folder too; `*` matches within a folder; and `{a,b}` matches either.
 * @param {string} glob
 */
function readGlob(glob) {
  let pattern = "";
  let depth = 0;
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (glob.startsWith("**/", index)) {
      pattern += "(?:.*/)?";
      index += 2;
    } else if (glob.startsWith("**", index)) {
      pattern += ".*";
      index += 1;
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "{") {
      pattern += "(?:";
      depth += 1;
    } else if (char === "}" && depth > 0) {
      pattern += ")";
      depth -= 1;
    } else if (char === "," && depth > 0) pattern += "|";
    else pattern += escapePattern(char);
  }
  if (depth > 0) throw new Error(`The glob ${glob} opens a brace it never closes.`);
  return new RegExp(`^${pattern}$`);
}

/**
 * Whether a path matches a glob.
 * @param {string} path
 * @param {string} glob
 */
export const matchesGlob = (path, glob) => readGlob(glob).test(path);

/**
 * The rules whose globs match any of the files.
 * @template {{ paths: string[] }} T
 * @param {string[]} files
 * @param {T[]} rules
 * @returns {T[]}
 */
export const listRulesFor = (files, rules) =>
  rules.filter((rule) => files.some((file) => rule.paths.some((glob) => matchesGlob(file, glob))));
