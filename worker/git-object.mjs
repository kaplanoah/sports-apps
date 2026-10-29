/** @param {unknown} value @returns {value is string} */
export const isGitObjectId = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

// git merge-tree's exit status when the merge conflicts, having still written the merged tree;
// any other failure is git's own error.
export const MERGE_TREE_CONFLICT = 1;
