import { parse } from "es-module-lexer/js";

/**
 * What a script's static imports, re-exports, and dynamic imports with a literal name name.
 * @param {string} text
 * @param {string} path named in the error when the text can't be read
 */
export const listSpecifiers = (text, path) =>
  parse(text, path)[0].flatMap(({ specifier }) =>
    typeof specifier === "string" ? [specifier] : [],
  );
