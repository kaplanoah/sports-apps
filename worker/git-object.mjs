/** @param {unknown} value @returns {value is string} */
export const isGitObjectId = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
