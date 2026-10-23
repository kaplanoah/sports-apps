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

/**
 * A step's input, through the YAML anchor it names when it names one.
 * @param {string} workflow the workflow's text
 * @param {string} step
 * @param {string} input
 */
export function readStepInput(workflow, step, input) {
  const value = step.match(new RegExp(`^ {10}${input}: (.*(?:\\n(?: {12}.*)?)*)`, "m"))?.[1] ?? "";
  const alias = value.trim().match(/^\*([\w-]+)$/)?.[1];
  if (!alias) return value.trim();
  return (
    workflow
      .match(new RegExp(`^ {10}[\\w-]+: &${alias} (.*(?:\\n(?: {12}.*)?)*)`, "m"))?.[1]
      ?.trim() ?? ""
  );
}
