import { Linter } from "eslint";
import { LOCAL_TIME_METHODS } from "../eslint.config.mjs";
import { listReachedFiles, resolveImport } from "./browser-scope.mjs";

export const NODE_TEST = /^(?:tests|(?:apps|services)\/[^/]+\/tests)\/[^/]+\.test\.js$/;
export const TIME_ZONE_SOURCE =
  /^(?:shared\/|apps\/[^/]+\/(?:page\/|worker\/)|services\/[^/]+\/worker\/|worker\/|\.claude\/hooks\/).+\.m?js$/;
const LOCAL_METHODS = new Set([...LOCAL_TIME_METHODS, "toLocaleString"]);
const FIXED_SETUP = "tests/eastern-time-zone.js";
const linter = new Linter();

/** @param {any} node */
const readProperty = (node) => (node?.computed ? node.property?.value : node?.property?.name);

/**
 * Native Date objects can later be formatted or coerced on the ambient calendar even when their
 * constructor takes an absolute timestamp. Only the numeric clock operations are excluded.
 * @param {string} text
 */
export function inspectTimeZoneCode(text) {
  let hasTimeApi = false;
  let firstImport = null;
  const messages = linter.verify(text, {
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    plugins: {
      calendar: {
        rules: {
          inventory: {
            create: () => ({
              Program(node) {
                const first = node.body[0];
                firstImport = first?.type === "ImportDeclaration" ? first.source.value : null;
              },
              Identifier(node) {
                const parent = node.parent;
                if (node.name === "Date") {
                  const isClock =
                    parent.type === "MemberExpression" &&
                    parent.object === node &&
                    ["now", "UTC"].includes(readProperty(parent));
                  if (!isClock) hasTimeApi = true;
                }
                if (node.name === "Intl") {
                  const isOtherFormatter =
                    parent.type === "MemberExpression" &&
                    parent.object === node &&
                    !["DateTimeFormat", undefined].includes(readProperty(parent));
                  if (!isOtherFormatter) hasTimeApi = true;
                }
              },
              MemberExpression(node) {
                if (
                  ["globalThis", "window", "self"].includes(node.object.name) &&
                  (["Date", "Intl"].includes(readProperty(node)) ||
                    (node.computed && node.property.type !== "Literal"))
                )
                  hasTimeApi = true;
              },
              CallExpression(node) {
                if (
                  (node.callee.type === "MemberExpression" &&
                    LOCAL_METHODS.has(readProperty(node.callee))) ||
                  ["eval", "Function"].includes(node.callee.name) ||
                  (node.callee.type === "MemberExpression" &&
                    /^runIn|^runInThis|^compileFunction$/.test(readProperty(node.callee) ?? ""))
                )
                  hasTimeApi = true;
                // Code passed to a child interpreter is outside the static import walk.
                if (
                  /spawn|exec/.test(node.callee.name ?? readProperty(node.callee) ?? "") &&
                  node.arguments.some(
                    (argument) =>
                      argument.type === "ArrayExpression" &&
                      argument.elements.some((item) => ["-e", "--eval"].includes(item?.value)),
                  )
                )
                  hasTimeApi = true;
              },
              NewExpression(node) {
                if (node.callee.name === "Function") hasTimeApi = true;
              },
              ImportExpression(node) {
                if (node.source.type !== "Literal") hasTimeApi = true;
              },
            }),
          },
        },
      },
    },
    rules: { "calendar/inventory": "error" },
  });
  if (messages.some((message) => message.fatal)) throw new Error("Could not classify JavaScript.");
  return { hasTimeApi, firstImport };
}

/**
 * Verifies an explicit inventory, rather than selecting tests from a change's dependencies.
 * @param {string[]} tests
 * @param {{ sensitive: string[], fixed: string[], browserOnly?: string[] }} manifest
 * @param {(path: string) => string | null} readText
 * @param {string[]} [sources]
 */
export function verifyTimeZoneCoverage(tests, manifest, readText, sources = []) {
  const facts = new Map();
  const covered = new Set();
  const read = (path) => {
    const text = readText(path);
    if (text !== null && !facts.has(path)) {
      try {
        facts.set(path, inspectTimeZoneCode(text));
      } catch (error) {
        throw new Error(
          `Cannot inventory ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return text;
  };
  const needed = [];
  for (const path of tests) {
    const reached = listReachedFiles([path], read);
    for (const file of reached) covered.add(file);
    if (manifest.fixed.includes(path)) {
      const setup = facts.get(path)?.firstImport;
      if (!setup || resolveImport(setup, path) !== FIXED_SETUP)
        throw new Error(`${path} must import ${FIXED_SETUP} first, before its tested modules.`);
    } else if ([...reached].some((file) => facts.get(file)?.hasTimeApi)) needed.push(path);
  }
  const missing = needed.filter((path) => !manifest.sensitive.includes(path));
  if (missing.length)
    throw new Error(
      `Add date/time coverage to tests/time-zone-sensitive.json: ${missing.join(", ")}`,
    );
  for (const path of sources) {
    read(path);
    if (facts.get(path)?.hasTimeApi && !covered.has(path) && !manifest.browserOnly?.includes(path))
      throw new Error(`Add a Node date/time test importing the native time API source: ${path}`);
  }
  for (const path of manifest.browserOnly ?? [])
    if (!sources.includes(path) || covered.has(path) || !facts.get(path)?.hasTimeApi)
      throw new Error(`Reclassify the browser-only time API source: ${path}`);
  for (const path of [...manifest.sensitive, ...manifest.fixed])
    if (!tests.includes(path))
      throw new Error(`Remove the missing test from the time-zone manifest: ${path}`);
  if (
    new Set([...manifest.sensitive, ...manifest.fixed]).size !==
    manifest.sensitive.length + manifest.fixed.length
  )
    throw new Error("Time-zone manifest entries must be unique.");
  if (!manifest.sensitive.length)
    throw new Error("The time-zone manifest must include sensitive tests.");
}
