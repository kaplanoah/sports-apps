// Reads the scoped rule files in .claude/rules/, which Claude Code loads once a session reads or
// edits a file one of their `paths` globs matches, so CI's review can hand each area the rules for
// its files (plan-review.mjs) and a test can check each glob still matches a file.

export const RULES_FOLDER = ".claude/rules/";

/**
 * Whether a path is a rule file.
 * @param {string} path
 */
export const isRuleFile = (path) => path.startsWith(RULES_FOLDER) && path.endsWith(".md");

/**
 * The `paths` globs a rule file's frontmatter lists, each a quoted item of its own, or none when
 * it has no frontmatter.
 * @param {string} text
 * @returns {string[]}
 */
export function readRulePaths(text) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  return [...frontmatter.matchAll(/^\s+- "([^"]+)"$/gm)].map((match) => match[1]);
}

/**
 * Whether a path matches a glob, where `**` matches across folders and `*` within one.
 * @param {string} path
 * @param {string} glob
 */
export function matchesGlob(path, glob) {
  const pattern = glob
    .split("**")
    .map((piece) =>
      piece
        .split("*")
        .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${pattern}$`).test(path);
}

/**
 * The rules whose globs match any of the files.
 * @template {{ paths: string[] }} T
 * @param {string[]} files
 * @param {T[]} rules
 * @returns {T[]}
 */
export const listRulesFor = (files, rules) =>
  rules.filter((rule) => files.some((file) => rule.paths.some((glob) => matchesGlob(file, glob))));
