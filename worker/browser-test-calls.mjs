import { Linter } from "eslint";

/** @param {any} node */
const isTestCall = (node) =>
  node.type === "CallExpression" &&
  node.callee.type === "Identifier" &&
  node.callee.name === "test";

/**
 * The first and last line of each test(...) call in a spec or helper, a test in a loop once.
 * @param {string} source
 * @returns {{ line: number, endLine: number }[]}
 */
export function findTestLines(source) {
  const linter = new Linter({ configType: "flat" });
  linter.verify(source, [{ languageOptions: { ecmaVersion: "latest", sourceType: "module" } }]);
  const { ast, visitorKeys } = linter.getSourceCode();
  /** @type {{ line: number, endLine: number }[]} */
  const tests = [];
  /** @param {any} node */
  const visit = (node) => {
    if (isTestCall(node)) tests.push({ line: node.loc.start.line, endLine: node.loc.end.line });
    for (const key of visitorKeys[node.type] ?? []) {
      for (const child of [node[key]].flat()) if (child?.type) visit(child);
    }
  };
  visit(ast);
  return tests;
}
