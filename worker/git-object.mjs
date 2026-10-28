/** @param {unknown} value @returns {value is string} */
export const isGitObjectId = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

/**
 * Whether `commit` is `of` or comes before it in its history, and false when git doesn't know
 * either one.
 * @param {(args: string[]) => string} git
 * @param {string} commit
 * @param {string} of
 */
export function isAncestor(git, commit, of) {
  try {
    git(["merge-base", "--is-ancestor", commit, of]);
    return true;
  } catch {
    return false;
  }
}
