// Where a `#name/...` import leads, by package.json's imports, as Node and the pages' import maps
// resolve it.
import { readFileSync } from "node:fs";

/** @type {Record<string, string>} */
const IMPORTS = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).imports;

/**
 * The file an import names, from the repo's root, or null for a name package.json doesn't map.
 * @param {string} specifier
 * @param {Record<string, string>} [imports] package.json's, by default
 */
export function resolvePackageImport(specifier, imports = IMPORTS) {
  for (const [name, target] of Object.entries(imports)) {
    const prefix = name.replace(/\*$/, "");
    const isMatch = name.endsWith("*") ? specifier.startsWith(prefix) : specifier === name;
    if (isMatch) return target.replace(/^\.\//, "").replace("*", specifier.slice(prefix.length));
  }
  return null;
}
