import { parse } from "es-module-lexer/js";

/**
 * What a script's static imports, re-exports, and dynamic imports with a literal name name.
 * @param {string} text
 */
export const listSpecifiers = (text) =>
  parse(text)[0].flatMap(({ specifier }) => (typeof specifier === "string" ? [specifier] : []));
