import { escapePattern } from "../shared/page/escape-pattern.js";

/**
 * @param {string} workflow
 * @param {string} name
 */
export function readStepScript(workflow, name) {
  const pattern = new RegExp(
    `^ {6}- name: ${escapePattern(name)}\\n(?: {8}.*\\n)*? {8}run: \\|\\n((?: {10}.*\\n)+)`,
    "m",
  );
  const script = workflow.match(pattern)?.[1];
  if (!script) throw new Error(`No shell script for ${name}`);
  return script;
}
