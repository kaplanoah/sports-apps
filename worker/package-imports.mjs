// Where a `#name/...` import leads, by package.json's imports, as Node and the pages' import maps
// resolve it.
import { readFileSync } from "node:fs";

/** @type {Record<string, string>} each a `#name/*` pattern and where it leads */
const IMPORTS = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).imports;

/**
 * The file an import names, from the repo's root, or null for a name package.json doesn't map.
 * @param {string} specifier
 */
export function resolvePackageImport(specifier) {
  for (const [pattern, target] of Object.entries(IMPORTS)) {
    const prefix = pattern.replace(/\*$/, "");
    if (specifier.startsWith(prefix))
      return target.replace(/^\.\//, "").replace("*", () => specifier.slice(prefix.length));
  }
  return null;
}
