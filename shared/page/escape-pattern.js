/**
 * Text made safe to match word for word in a regular expression.
 * @param {string} text
 */
export const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
