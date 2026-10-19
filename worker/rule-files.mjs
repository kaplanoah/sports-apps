// Reads the scoped rule files in .claude/rules/, which Claude Code loads once a session reads or
// edits a file one of their `paths` globs matches, so a file's rules are known without a session.

export const RULES_FOLDER = ".claude/rules/";

/**
 * Whether a path is a rule file.
 * @param {string} path
 */
export const isRuleFile = (path) => path.startsWith(RULES_FOLDER) && path.endsWith(".md");

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

/** @param {string} text */
const escapeText = (text) => text.replace(/[.+?^$()|[\]\\]/g, "\\$&");

/**
 * A glob as a regular expression: `**` matches across folders, and a `**` followed by a slash
 * matches no folder too; `*` matches within a folder; and `{a,b}` matches either.
 * @param {string} glob
 */
function readGlob(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (glob.startsWith("**/", index)) {
      pattern += "(?:.*/)?";
      index += 2;
    } else if (glob.startsWith("**", index)) {
      pattern += ".*";
      index += 1;
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "{") pattern += "(?:";
    else if (char === "}") pattern += ")";
    else if (char === ",") pattern += "|";
    else pattern += escapeText(char);
  }
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
