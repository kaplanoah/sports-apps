import { runInNewContext } from "node:vm";
import { readRepoFile } from "./repo-files.js";
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

/** @param {Record<string,string>} env */
export function readNativeReviewName(env) {
  const github = {
    repository: env.REPOSITORY ?? "example/repository",
    sha: env.REVIEW_TRUSTED ?? "d".repeat(40),
    event: {
      action: env.ACTION,
      label: { name: env.LABEL },
      pull_request: {
        number: Number(env.PR ?? "1"),
        draft: env.IS_DRAFT === "true",
        user: { login: env.AUTHOR },
        author_association: env.ASSOCIATION,
        head: { sha: env.REVIEW_HEAD ?? "a".repeat(40), repo: { full_name: env.HEAD_REPOSITORY } },
        base: { sha: env.REVIEW_BASE ?? "b".repeat(40), ref: env.BASE_REF ?? "main" },
      },
    },
  };
  const title = readRepoFile(".github/workflows/review.yml").match(
    /^run-name: &review-name (.*)$/m,
  )?.[1];
  if (!title) throw new Error("Missing native review title anchor");
  return title.replace(/\$\{\{ (.*?) \}\}/g, (_, expression) =>
    String(
      runInNewContext(
        expression,
        { github, contains: (list, value) => list.includes(value), fromJSON: JSON.parse },
        { timeout: 1000 },
      ),
    ),
  );
}

/** @param {Record<string,string>} env */
export const createReviewDecisionEnvironment = (env) => ({
  ...env,
  REVIEW_RUN_NAME: readNativeReviewName(env),
});
