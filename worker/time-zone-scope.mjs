import { Linter } from "eslint";
import { LOCAL_TIME_METHODS } from "../eslint.config.mjs";
import { listReachedFiles, resolveImport } from "./browser-scope.mjs";

export const TIME_ZONE_SOURCE =
  /^(?!.*\.min\.js$)(?:shared\/|apps\/[^/]+\/(?:page\/|worker\/)|services\/[^/]+\/worker\/|worker\/|\.claude\/hooks\/).+\.m?js$/;
const LOCAL_METHODS = new Set([...LOCAL_TIME_METHODS, "toLocaleString"]);
const FIXED_SETUP = "tests/eastern-time-zone.js";
const linter = new Linter();

/** @param {any} node */
const readProperty = (node) => (node?.computed ? node.property?.value : node?.property?.name);

/** @param {any} node */
const isNativeTimeLookup = (node) =>
  ["globalThis", "window", "self"].includes(node.object.name) &&
  (["Date", "Intl"].includes(readProperty(node)) ||
    (node.computed && node.property.type !== "Literal"));

/** @param {any} node */
const isLocalTimeCall = (node) =>
  node.callee.type === "MemberExpression" && LOCAL_METHODS.has(readProperty(node.callee));

/** @param {any} node */
const isOpaqueExecution = (node) =>
  ["eval", "Function"].includes(node.callee.name) ||
  (node.callee.type === "MemberExpression" &&
    /^runIn|^compileFunction$/.test(readProperty(node.callee) ?? ""));

/** @param {any} node */
const isEvalSpawn = (node) =>
  /spawn|exec/.test(node.callee.name ?? readProperty(node.callee) ?? "") &&
  node.arguments.some(
    (argument) =>
      argument.type === "ArrayExpression" &&
      argument.elements.some((item) => ["-e", "--eval"].includes(item?.value)),
  );

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
                if (isNativeTimeLookup(node)) hasTimeApi = true;
              },
              CallExpression(node) {
                if (isLocalTimeCall(node) || isOpaqueExecution(node) || isEvalSpawn(node))
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

/** @param {string} path @param {string | null} setup */
function verifyFixedSetup(path, setup) {
  if (!setup || resolveImport(setup, path) !== FIXED_SETUP)
    throw new Error(`${path} must import ${FIXED_SETUP} first, before its tested modules.`);
}

/**
 * @param {string[]} tests
 * @param {string[]} fixed
 * @param {(path: string) => string | null} readText
 */
function readTimeZoneInventory(tests, fixed, readText) {
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
          { cause: error },
        );
      }
    }
    return text;
  };
  const needed = [];
  for (const path of tests) {
    const reached = listReachedFiles([path], read);
    for (const file of reached) covered.add(file);
    if (fixed.includes(path)) verifyFixedSetup(path, facts.get(path)?.firstImport);
    else if ([...reached].some((file) => facts.get(file)?.hasTimeApi)) needed.push(path);
  }
  return { facts, covered, needed, read };
}

/** @param {string[]} needed @param {string[]} sensitive */
function verifySensitiveCoverage(needed, sensitive) {
  const missing = needed.filter((path) => !sensitive.includes(path));
  if (missing.length)
    throw new Error(
      `Add date/time coverage to tests/time-zone-sensitive.json: ${missing.join(", ")}`,
    );
}

/**
 * @param {string[]} sources
 * @param {string[]} browserOnly
 * @param {ReturnType<typeof readTimeZoneInventory>} inventory
 */
function verifySourceCoverage(sources, browserOnly, { facts, covered, read }) {
  for (const path of sources) {
    read(path);
    if (facts.get(path)?.hasTimeApi && !covered.has(path) && !browserOnly.includes(path))
      throw new Error(`Add a Node date/time test importing the native time API source: ${path}`);
  }
  for (const path of browserOnly)
    if (!sources.includes(path) || covered.has(path) || !facts.get(path)?.hasTimeApi)
      throw new Error(`Reclassify the browser-only time API source: ${path}`);
}

/** @param {string[]} tests @param {string[]} sensitive @param {string[]} fixed */
function verifyManifestEntries(tests, sensitive, fixed) {
  const listed = [...sensitive, ...fixed];
  for (const path of listed)
    if (!tests.includes(path))
      throw new Error(`Remove the missing test from the time-zone manifest: ${path}`);
  if (new Set(listed).size !== listed.length)
    throw new Error("Time-zone manifest entries must be unique.");
  if (!sensitive.length) throw new Error("The time-zone manifest must include sensitive tests.");
}

/**
 * Verifies an explicit inventory, rather than selecting tests from a change's dependencies.
 * @param {string[]} tests
 * @param {{ sensitive: string[], fixed: string[], browserOnly?: string[] }} manifest
 * @param {(path: string) => string | null} readText
 * @param {string[]} [sources]
 */
export function verifyTimeZoneCoverage(tests, manifest, readText, sources = []) {
  const inventory = readTimeZoneInventory(tests, manifest.fixed, readText);
  verifySensitiveCoverage(inventory.needed, manifest.sensitive);
  verifySourceCoverage(sources, manifest.browserOnly ?? [], inventory);
  verifyManifestEntries(tests, manifest.sensitive, manifest.fixed);
}
