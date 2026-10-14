import js from "@eslint/js";
import globals from "globals";

// A bullet or middle dot typed by hand, as a character, an escape, or an HTML entity.
const HAND_SEPARATOR = String.raw`/\u2022|\u00b7|&bull;|&middot;|&#8226;|&#183;/`;

// The Date methods that read or write a moment on the machine's own calendar and clock.
const LOCAL_TIME_METHODS = [
  "getDate",
  "getDay",
  "getFullYear",
  "getHours",
  "getMinutes",
  "getMonth",
  "getSeconds",
  "getTimezoneOffset",
  "setDate",
  "setFullYear",
  "setHours",
  "setMinutes",
  "setMonth",
  "setSeconds",
  "toDateString",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toTimeString",
];

const LOCAL_TIME_RESTRICTIONS = LOCAL_TIME_METHODS.map((property) => ({
  property,
  message: "Read and format days and times with shared/page/days.js.",
}));

// The Messages API's address, which only shared/worker/claude.js calls.
const CLAUDE_MESSAGES = String.raw`/api\.anthropic\.com.v1.messages/`;

const DEVICE_STORAGES = ["localStorage", "sessionStorage"];
const DEVICE_STORAGE_MESSAGE =
  "Keep a viewer's choice with createViewerChoice from shared/page/device-storage.js.";

// A generic name hides what a function does; calling a library's run is fine, declaring one is not.
// A later block's no-restricted-syntax replaces this one's for its files, so each such block lists
// these too.
const GENERIC_NAME = "/^(call|run|execute|handle)$/";
const GENERIC_FUNCTION_NAMES = [
  `FunctionDeclaration[id.name=${GENERIC_NAME}]`,
  `MethodDefinition[key.name=${GENERIC_NAME}]`,
  `Property[key.name=${GENERIC_NAME}][value.type=/FunctionExpression$/]`,
  `PropertyDefinition[key.name=${GENERIC_NAME}][value.type=/FunctionExpression$/]`,
  `VariableDeclarator[id.name=${GENERIC_NAME}][init.type=/FunctionExpression$/]`,
].map((selector) => ({
  selector,
  message: "Name the function with a verb for what it does, not call, run, execute, or handle.",
}));

export default [
  { ignores: [".claude/worktrees/", "apps/*/worker/dist/", "apps/*/page/js/sortable.min.js"] },
  js.configs.recommended,
  { rules: { "no-unused-vars": ["error", { ignoreRestSiblings: true }] } },
  { files: ["**/*.{js,mjs}"], languageOptions: { sourceType: "module", globals: globals.node } },
  {
    files: ["**/*.{js,mjs}"],
    rules: { "no-restricted-syntax": ["error", ...GENERIC_FUNCTION_NAMES] },
  },
  {
    files: ["apps/*/page/js/**/*.js", "shared/page/**/*.js"],
    languageOptions: { globals: { ...globals.browser, Sortable: "readonly" } },
  },
  {
    // Markup reaches the page only through setHtml, which escapes whatever html`` didn't build,
    // and lists of facts only through joinWithSeparator, so they all read the same way.
    // show-last-drawn.js only puts back markup setHtml wrote.
    files: ["apps/*/page/js/**/*.js", "shared/page/**/*.js"],
    ignores: ["shared/page/html.js", "shared/page/show-last-drawn.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...GENERIC_FUNCTION_NAMES,
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]",
          message: "Write markup with setHtml from html.js.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Write markup with setHtml from html.js.",
        },
        {
          selector: `Literal[value=${HAND_SEPARATOR}], TemplateElement[value.cooked=${HAND_SEPARATOR}]`,
          message: "Separate items with joinWithSeparator from html.js.",
        },
      ],
    },
  },
  {
    // Only days.js reads the viewer's calendar and clock, so a day or time reads the same in every
    // zone, which its tests check zone by zone.
    files: [
      "apps/*/page/**/*.js",
      "apps/*/worker/src/**/*.js",
      "shared/**/*.js",
      "worker/**/*.mjs",
    ],
    ignores: ["shared/page/days.js"],
    rules: { "no-restricted-properties": ["error", ...LOCAL_TIME_RESTRICTIONS] },
  },
  {
    // An app's page keeps a viewer's choice only through createViewerChoice in
    // shared/page/device-storage.js, which keeps it as JSON under its own key, lists it, and tells
    // the page's other tabs when it changes. A block's rule replaces an earlier block's, so this
    // one keeps the local-time restrictions too.
    files: ["apps/*/page/js/**/*.js"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...DEVICE_STORAGES.map((name) => ({ name, message: DEVICE_STORAGE_MESSAGE })),
      ],
      "no-restricted-properties": [
        "error",
        ...LOCAL_TIME_RESTRICTIONS,
        ...DEVICE_STORAGES.map((property) => ({
          object: "window",
          property,
          message: DEVICE_STORAGE_MESSAGE,
        })),
      ],
    },
  },
  {
    // A change to shared code reaches every app, so an app hands it what it needs instead.
    files: ["shared/**/*.{js,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)apps/|^#page-files/",
              message:
                "Shared code never imports an app's modules: have the app hand it what differs.",
            },
          ],
        },
      ],
    },
  },
  {
    // A plain script the page loads before its modules, whose functions the page calls.
    files: [
      "shared/page/open-last-tab.js",
      "shared/page/show-last-drawn.js",
      "shared/page/slow-load.js",
    ],
    languageOptions: { sourceType: "script" },
    rules: { "no-unused-vars": ["error", { vars: "local" }] },
  },
  {
    // A plain script the build writes into the page's head.
    files: ["shared/page/release-guard.js"],
    languageOptions: { sourceType: "script" },
  },
  {
    files: ["apps/*/page/sw.js", "shared/page/push-worker.js", "shared/page/offline-worker.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        noteWorkerStep: "readonly",
        describeFailure: "readonly",
      },
    },
  },
  {
    // A plain script sw.js loads first, whose functions the worker's other scripts call.
    files: ["shared/page/service-worker-steps.js"],
    languageOptions: { sourceType: "script", globals: globals.serviceworker },
    rules: { "no-unused-vars": ["error", { vars: "local" }] },
  },
  {
    files: ["apps/*/worker/src/**/*.js", "shared/worker/**/*.js"],
    languageOptions: { globals: { ...globals.serviceworker, WebSocketPair: "readonly" } },
  },
  {
    // Every answer the Worker and the tooling ask Claude for comes through requestClaude, which holds
    // it to a JSON schema, so none has to be picked out of prose.
    files: ["apps/*/worker/src/**/*.js", "shared/worker/**/*.js", "worker/**/*.mjs"],
    ignores: ["shared/worker/claude.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...GENERIC_FUNCTION_NAMES,
        {
          selector: `Literal[value=${CLAUDE_MESSAGES}], TemplateElement[value.cooked=${CLAUDE_MESSAGES}]`,
          message: "Ask Claude with requestClaude from shared/worker/claude.js and a JSON schema.",
        },
      ],
    },
  },
  {
    // Callbacks passed to page.evaluate run in the page.
    files: ["apps/*/tests/browser/*.mjs", "tests/browser/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // A fixed wait, or one for the network to go quiet, is too short on a slow machine and wasted
      // time on a fast one.
      "no-restricted-syntax": [
        "error",
        ...GENERIC_FUNCTION_NAMES,
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            "Wait for what the page shows with expect, or move the page's clock with page.clock.",
        },
        {
          selector: "CallExpression[callee.name='setTimeout']",
          message:
            "Wait for what the page shows with expect, or move the page's clock with page.clock.",
        },
        {
          selector:
            "CallExpression[callee.property.name='waitForLoadState'][arguments.0.value='networkidle']",
          message:
            "Wait for what the page shows with expect, or for the reads it makes with expect.poll.",
        },
        {
          selector: "Property[key.name='waitUntil'][value.value='networkidle']",
          message:
            "Wait for what the page shows with expect, or for the reads it makes with expect.poll.",
        },
        {
          // Playwright asks the test about every request a function might match.
          selector:
            "CallExpression[callee.property.name=/^(route|unroute)$/][arguments.0.type=/FunctionExpression$/]",
          message:
            "Match the route with a pattern, like matchPath's from tests/browser/harness.mjs.",
        },
      ],
    },
  },
];
