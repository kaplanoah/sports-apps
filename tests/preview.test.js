import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listApps } from "../worker/apps.mjs";
import {
  buildPreviews,
  describePreview,
  isPreviewWanted,
  judgePreviews,
  listPreviewedApps,
  namePreview,
  readBuild,
  readPreviewAccess,
  syncPreviews,
} from "../worker/preview.mjs";
import { readRepoFile } from "./repo-files.js";

const API = "https://api.cloudflare.com/client/v4";
const BASE = "b".repeat(40);
const COMMIT = "c".repeat(40);
const REPOSITORY = "owner/sports-apps";
const ENV = {
  CLOUDFLARE_ACCOUNT_ID: "acct123",
  GITHUB_REPOSITORY: REPOSITORY,
  GH_TOKEN: "token",
  ACCESS_CODE: "code",
  MLB_BETA_PAGE_URL: "https://mlb-app-beta.example.workers.dev/k3y/",
  WNBA_BETA_PAGE_URL: "https://wnba-app-beta.example.workers.dev/k3y",
  MLB_PREVIEW_HOST: "mlb-previews.example.com",
  WNBA_PREVIEW_HOST: "wnba-previews.example.com",
};
const HOSTS = [ENV.MLB_PREVIEW_HOST, ENV.WNBA_PREVIEW_HOST];

/**
 * Each section of a wrangler.toml by its header, with its settings and no comments.
 * @param {string} toml
 */
function readSections(toml) {
  const sections = toml.split(/^(?=\[)/m).slice(1);
  return new Map(
    sections.map((section) => {
      const [header, ...lines] = section.split("\n");
      const settings = lines.filter((line) => line.trim() && !line.startsWith("#"));
      return [header, settings.join("\n")];
    }),
  );
}

/** @param {string} app */
const readAppSections = (app) => readSections(readRepoFile(`apps/${app}/worker/wrangler.toml`));

test("each app's previews bind only beta's own Worker, by its preview entrypoint, with no store or secret of their own", () => {
  for (const app of listApps()) {
    const sections = readAppSections(app);
    const previewHeaders = [...sections.keys()].filter((header) => header.includes(".previews."));
    assert.deepEqual(
      previewHeaders,
      ["[env.beta.previews.observability]", "[[env.beta.previews.services]]"],
      app,
    );
    assert.equal(
      sections.get("[[env.beta.previews.services]]"),
      `binding = "BETA"\nservice = "${app}-app-beta"\nentrypoint = "PreviewEntrypoint"`,
      app,
    );
    assert.match(sections.get("[env.beta]") ?? "", /^preview_urls = false$/m, app);
  }
});

test("a preview is named for its pull request, and opens as beta's page at that name under its app's host", () => {
  assert.equal(namePreview(12), "pr-12");
  assert.deepEqual(readPreviewAccess("mlb", 12, ENV), {
    host: "mlb-previews.example.com",
    pageUrl: "https://pr-12.mlb-previews.example.com/k3y/",
    accessCode: "code",
  });
  assert.equal(
    readPreviewAccess("wnba", 12, ENV).pageUrl,
    "https://pr-12.wnba-previews.example.com/k3y/",
  );
  assert.throws(
    () => readPreviewAccess("wnba", 12, { ...ENV, WNBA_PREVIEW_HOST: "" }),
    /^Error: Set the preview environment's WNBA_PREVIEW_HOST\.$/,
  );
  assert.throws(
    () => readPreviewAccess("mlb", 12, { ...ENV, MLB_BETA_PAGE_URL: "", MLB_PREVIEW_HOST: "" }),
    /^Error: Set the preview environment's MLB_BETA_PAGE_URL and MLB_PREVIEW_HOST\.$/,
  );
});

test("only the apps a pull request's changes deploy get a preview", () => {
  const apps = ["mlb", "wnba"];
  assert.deepEqual(listPreviewedApps(["apps/mlb/page/styles.css", "README.md"], apps), ["mlb"]);
  assert.deepEqual(listPreviewedApps(["shared/page/sheet.js"], apps), apps);
  assert.deepEqual(listPreviewedApps(["README.md", "tests/preview.test.js"], apps), []);
  assert.deepEqual(listPreviewedApps(null, apps), apps);
});

/**
 * Git for a pull request that changes the files.
 * @param {string[]} files
 */
const createFakeGit = (files) => (/** @type {string[]} */ args) => {
  if (args[0] === "merge-base") return BASE;
  if (args[0] === "diff") return files.join("\n");
  throw new Error(`unexpected git ${args.join(" ")}`);
};

const createFolder = () => mkdtempSync(path.join(tmpdir(), "preview-"));

test("a pull request's build is each app it changes, built as beta, and a manifest naming them", async () => {
  const folder = createFolder();
  const source = path.join(createFolder(), "worker.mjs");
  writeFileSync(source, "export default {};");
  const built = [];
  const apps = await buildPreviews({
    pullRequest: "12",
    base: BASE,
    git: createFakeGit(["apps/wnba/page/styles.css"]),
    buildApp: async (app, options) => {
      built.push([app, options]);
      return { output: source, size: 0 };
    },
    folder,
    log: () => {},
  });

  assert.deepEqual(apps, ["wnba"]);
  assert.deepEqual(built, [["wnba", { channel: "beta" }]]);
  assert.equal(readFileSync(path.join(folder, "wnba.mjs"), "utf8"), "export default {};");
  assert.deepEqual(readBuild(folder), { pullRequest: "12", apps: ["wnba"] });
});

test("a build hands on only this repo's apps whose bundles it holds, and a pull request's number", () => {
  const folder = createFolder();
  writeFileSync(path.join(folder, "mlb.mjs"), "");
  writeFileSync(path.join(folder, "other.mjs"), "");
  const writeManifest = (manifest) =>
    writeFileSync(path.join(folder, "build.json"), JSON.stringify(manifest));

  writeManifest({ pullRequest: 12, apps: ["mlb", "wnba", "other"] });
  assert.deepEqual(readBuild(folder), { pullRequest: "12", apps: ["mlb"] });
  writeManifest({ pullRequest: 12, apps: "mlb" });
  assert.deepEqual(readBuild(folder).apps, []);
  for (const pullRequest of ["12/../../pulls", -1, null]) {
    writeManifest({ pullRequest, apps: ["mlb"] });
    assert.throws(() => readBuild(folder), /^Error: Name the pull request by its number\.$/);
  }
});

/**
 * A pull request as GitHub describes it.
 * @param {object} [options]
 * @param {string} [options.state]
 * @param {string[]} [options.labels]
 * @param {string} [options.repository] the repository its branch is in
 * @param {string} [options.sha]
 */
const describePull = ({
  state = "open",
  labels = ["preview"],
  repository = REPOSITORY,
  sha = COMMIT,
} = {}) => ({
  state,
  labels: labels.map((name) => ({ name })),
  head: { sha, repo: { full_name: repository } },
});

test("a pull request asks for previews only while it's open, from this repo, and labeled preview", () => {
  assert.equal(isPreviewWanted(describePull(), REPOSITORY), true);
  assert.equal(isPreviewWanted(describePull({ state: "closed" }), REPOSITORY), false);
  assert.equal(isPreviewWanted(describePull({ labels: ["beta"] }), REPOSITORY), false);
  assert.equal(
    isPreviewWanted(describePull({ repository: "someone/sports-apps" }), REPOSITORY),
    false,
  );
  assert.equal(isPreviewWanted({ ...describePull(), head: { repo: null } }, REPOSITORY), false);
});

test("the previews' state is up only once every one drew", () => {
  const drawn = { status: "drawn", reason: "" };
  const unchecked = { status: "unchecked", reason: "" };
  const broken = { status: "broken", reason: "" };
  assert.equal(judgePreviews(false, [drawn]), "deleted");
  assert.equal(judgePreviews(true, []), "unchanged");
  assert.equal(judgePreviews(true, [drawn, drawn]), "up");
  assert.equal(judgePreviews(true, [drawn, unchecked]), "unchecked");
  assert.equal(judgePreviews(true, [unchecked, broken]), "broken");
});

/**
 * GitHub, with the pull request and its comments, and Cloudflare, with the previews it already
 * lacks, and each call either was sent.
 * @param {object} [options]
 * @param {ReturnType<typeof describePull>} [options.pull]
 * @param {{ id: number, body: string }[]} [options.comments]
 * @param {string[]} [options.missingWorkers] the Workers that have no preview to delete
 */
function createFakeApis({ pull = describePull(), comments = [], missingWorkers = [] } = {}) {
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const address = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: address, method, body: init?.body });
    if (address.startsWith(API)) {
      const isMissing = missingWorkers.some((worker) => address.includes(`/${worker}/`));
      return new Response(JSON.stringify({ success: !isMissing, result: {} }), {
        status: isMissing ? 404 : 200,
      });
    }
    if (method !== "GET") return new Response("{}");
    return new Response(JSON.stringify(address.includes("/comments") ? comments : pull));
  };
  const listSent = (method) =>
    calls
      .filter((call) => call.method === method)
      .map((call) => [call.url, call.body && JSON.parse(call.body).body]);
  return { fetchImpl, calls, listSent };
}

/**
 * A build folder holding the apps' bundles.
 * @param {string[]} apps
 */
function createBuild(apps) {
  const folder = createFolder();
  for (const app of apps) writeFileSync(path.join(folder, `${app}.mjs`), `// ${app}`);
  writeFileSync(path.join(folder, "build.json"), JSON.stringify({ pullRequest: 12, apps }));
  return folder;
}

const UPLOAD = ["preview", "--config", "apps/mlb/worker/wrangler.toml", "--env", "beta"];

/**
 * Syncs the previews with the fakes, keeping what each was asked and what the run logged.
 * @param {object} options
 * @param {string[]} options.built
 * @param {ReturnType<typeof createFakeApis>} options.apis
 * @param {(args: string[]) => Promise<string>} [options.wrangler]
 * @param {import("../worker/check-page.mjs").PageCheck} [options.check]
 */
function syncWithFakes({ built, apis, wrangler, check = { status: "drawn", reason: "" } }) {
  const seen = { placed: [], uploads: [], opened: [], log: [] };
  const run = syncPreviews({
    commit: COMMIT,
    folder: createBuild(built),
    place: (bundle, app) => seen.placed.push([path.basename(bundle), app]),
    wrangler:
      wrangler ??
      (async (args) => {
        seen.uploads.push(args);
        return "{}";
      }),
    checkPage: async ({ access, commit, attempts, isLiveChecked }) => {
      seen.opened.push({ access, commit, attempts, isLiveChecked });
      return check;
    },
    fetchImpl: apis.fetchImpl,
    env: ENV,
    log: (line) => seen.log.push(line),
  });
  return { run, seen };
}

/**
 * Asserts nothing logged or sent names a preview host.
 * @param {string[]} log
 * @param {ReturnType<typeof createFakeApis>} apis
 */
function assertNoHost(log, apis) {
  for (const shown of [...log, ...apis.calls.map((call) => String(call.body ?? ""))]) {
    for (const host of HOSTS) assert.ok(!shown.includes(host), shown);
  }
}

const describeDelete = (worker) => [
  `${API}/accounts/acct123/workers/workers/${worker}/previews/pr-12`,
  undefined,
];

test("a pull request's preview is uploaded from its build, opened, and announced without its address, and any other app's is deleted", async () => {
  const apis = createFakeApis({ missingWorkers: ["wnba-app-beta"] });
  const { run, seen } = syncWithFakes({ built: ["mlb"], apis });
  assert.deepEqual(await run, ["mlb"]);

  assert.deepEqual(seen.placed, [["mlb.mjs", "mlb"]]);
  assert.deepEqual(seen.uploads, [[...UPLOAD, "--name", "pr-12", "--json"]]);
  assert.deepEqual(seen.opened, [
    {
      access: { pageUrl: "https://pr-12.mlb-previews.example.com/k3y/", accessCode: "code" },
      commit: COMMIT,
      attempts: 6,
      isLiveChecked: true,
    },
  ]);
  assert.deepEqual(seen.log, [
    "wnba preview pr-12: none",
    "mlb preview pr-12: uploaded",
    "mlb preview check: drawn",
  ]);
  assert.deepEqual(apis.listSent("DELETE"), [describeDelete("wnba-app-beta")]);
  assert.deepEqual(apis.listSent("POST"), [
    [
      `https://api.github.com/repos/${REPOSITORY}/issues/12/comments`,
      describePreview({ pullRequest: "12", apps: ["mlb"], state: "up", commit: COMMIT }),
    ],
  ]);
  assertNoHost(seen.log, apis);
});

test("a build of a commit the pull request has moved past changes nothing", async () => {
  const apis = createFakeApis({ pull: describePull({ sha: "d".repeat(40) }) });
  const { run, seen } = syncWithFakes({ built: ["mlb"], apis });
  assert.deepEqual(await run, []);
  assert.deepEqual(seen.uploads, []);
  assert.deepEqual(seen.log, ["The pull request has a newer commit, whose build follows."]);
  assert.deepEqual(
    apis.calls.map((call) => call.method),
    ["GET"],
  );
});

test("a pull request that no longer asks for previews has every app's deleted, and says so", async () => {
  const comment = describePreview({ pullRequest: 12, apps: ["mlb"], state: "up", commit: COMMIT });
  const apis = createFakeApis({
    pull: describePull({ labels: [] }),
    comments: [{ id: 7, body: comment }],
  });
  const { run, seen } = syncWithFakes({ built: ["mlb"], apis });
  assert.deepEqual(await run, []);

  assert.deepEqual(seen.uploads, []);
  assert.deepEqual(apis.listSent("DELETE"), [
    describeDelete("mlb-app-beta"),
    describeDelete("wnba-app-beta"),
  ]);
  assert.deepEqual(apis.listSent("PATCH"), [
    [
      `https://api.github.com/repos/${REPOSITORY}/issues/comments/7`,
      describePreview({ pullRequest: 12, apps: [], state: "deleted", commit: COMMIT }),
    ],
  ]);
});

test("a preview that couldn't be checked or didn't open fails the run, saying why without its address", async () => {
  for (const status of ["unchecked", "broken"]) {
    const apis = createFakeApis();
    const reason = `no games drawn at https://pr-12.${ENV.MLB_PREVIEW_HOST}/`;
    const { run, seen } = syncWithFakes({ built: ["mlb"], apis, check: { status, reason } });
    await assert.rejects(run, /^Error: The preview didn't open for mlb\.$/, status);

    assert.deepEqual(seen.log.slice(-1), [
      `mlb preview check: ${status}: no games drawn at https://pr-12.<preview host>/`,
    ]);
    assert.deepEqual(
      apis.listSent("POST").map(([, body]) => body),
      [describePreview({ pullRequest: 12, apps: ["mlb"], state: status, commit: COMMIT })],
    );
    assertNoHost(seen.log, apis);
  }
});

test("an upload wrangler refuses fails the run, saying why without the address", async () => {
  const refusal = Object.assign(new Error("Command failed"), {
    stderr: `Uploading\nCouldn't route pr-12.${ENV.MLB_PREVIEW_HOST}\n`,
  });
  const { run } = syncWithFakes({
    built: ["mlb"],
    apis: createFakeApis(),
    wrangler: async () => {
      throw refusal;
    },
  });
  await assert.rejects(run, (/** @type {Error} */ error) => {
    assert.equal(
      error.message,
      "mlb preview failed: Uploading\nCouldn't route pr-12.<preview host>",
    );
    return true;
  });
});

test("a pull request that changes no app's Worker gets no preview, and says so", async () => {
  const apis = createFakeApis();
  const { run, seen } = syncWithFakes({ built: [], apis });
  assert.deepEqual(await run, []);
  assert.deepEqual(seen.uploads, []);
  assert.equal(apis.listSent("DELETE").length, listApps().length);
  assert.match(apis.listSent("POST")[0][1], /no preview `pr-12`/);
});

test("a session can't run wrangler, or make or delete a preview, itself", () => {
  const { permissions } = JSON.parse(readRepoFile(".claude/settings.json"));
  for (const rule of [
    "Bash(wrangler *)",
    "Bash(npx wrangler *)",
    "Bash(npx --no-install wrangler *)",
    "Bash(npx -y wrangler*)",
    "Bash(npm exec * wrangler*)",
    "Bash(node_modules/.bin/wrangler*)",
    "Bash(node worker/preview.mjs*)",
  ]) {
    assert.ok(permissions.deny.includes(rule), rule);
  }
  assert.ok(permissions.ask.includes("Bash(npm run set-preview-host *)"));
});

const BUILD_WORKFLOW = readRepoFile(".github/workflows/preview-build.yml");
const WORKFLOW = readRepoFile(".github/workflows/preview.yml");

/**
 * @param {string} workflow
 * @param {string} job
 */
function readJobText(workflow, job) {
  const text = workflow.match(new RegExp(`^ {2}${job}:\\n(?:(?: {4}.*)?\\n)*`, "m"))?.[0];
  assert.ok(text, job);
  return text;
}

/**
 * A job's `if:`, as a test over the event's context, read by the few rules of GitHub's
 * expressions the workflows use.
 * @param {string} workflow
 * @param {string} job
 */
function readJobCondition(workflow, job) {
  const text = readJobText(workflow, job);
  const folded = text.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m)?.[1];
  assert.ok(folded, job);
  const expression = folded
    .split("\n")
    .map((line) => line.trim())
    .join(" ");
  const script = expression
    .replaceAll(/\.\*\.(\w+)/g, ".map((item) => item.$1)")
    .replaceAll("==", "===");
  return /** @type {(github: object, contains: Function) => boolean} */ (
    new Function("github", "contains", `return ${script};`)
  );
}

const contains = (list, value) => list.includes(value);

/**
 * The context of a pull request's event.
 * @param {object} options
 * @param {string} options.action
 * @param {string[]} [options.labels] the pull request's labels
 * @param {string} [options.label] the label the event added or took off
 * @param {boolean} [options.isFork]
 */
const describeEvent = ({ action, labels = [], label, isFork = false }) => ({
  repository: REPOSITORY,
  event: {
    action,
    label: label ? { name: label } : undefined,
    pull_request: {
      labels: labels.map((name) => ({ name })),
      head: { repo: { full_name: isFork ? "someone/sports-apps" : REPOSITORY } },
    },
  },
});

test("the Preview build runs only for a pull request from this repo whose preview label or code changed", () => {
  const isBuilt = readJobCondition(BUILD_WORKFLOW, "build");
  /** @type {[Parameters<typeof describeEvent>[0], boolean][]} */
  const cases = [
    [{ action: "labeled", label: "preview", labels: ["preview"] }, true],
    [{ action: "labeled", label: "beta", labels: ["beta", "preview"] }, false],
    [{ action: "synchronize", labels: ["preview"] }, true],
    [{ action: "reopened", labels: ["preview"] }, true],
    [{ action: "synchronize", labels: ["beta"] }, false],
    [{ action: "opened", labels: ["preview"] }, false],
    [{ action: "unlabeled", label: "preview" }, true],
    [{ action: "unlabeled", label: "beta", labels: ["preview"] }, false],
    [{ action: "closed", labels: ["preview"] }, true],
    [{ action: "closed", labels: [] }, false],
  ];
  for (const [event, isExpected] of cases) {
    assert.equal(isBuilt(describeEvent(event), contains), isExpected, JSON.stringify(event));
    assert.equal(isBuilt(describeEvent({ ...event, isFork: true }), contains), false, "a fork's");
  }
  assert.match(
    BUILD_WORKFLOW,
    /^on:\n {2}pull_request:\n {4}types: \[labeled, unlabeled, synchronize, reopened, closed\]\n\n/m,
  );
});

test("the Preview workflow takes only a finished build of a pull request from this repo", () => {
  const isSynced = readJobCondition(WORKFLOW, "sync");
  /**
   * @param {string} conclusion
   * @param {string} repository the repository the build's branch is in
   */
  const describeRun = (conclusion, repository) => ({
    repository: REPOSITORY,
    event: { workflow_run: { conclusion, head_repository: { full_name: repository } } },
  });
  assert.equal(isSynced(describeRun("success", REPOSITORY), contains), true);
  assert.equal(isSynced(describeRun("failure", REPOSITORY), contains), false);
  assert.equal(isSynced(describeRun("cancelled", REPOSITORY), contains), false);
  assert.equal(isSynced(describeRun("success", "someone/sports-apps"), contains), false);
  assert.match(
    WORKFLOW,
    /^on:\n {2}workflow_run:\n {4}workflows: \[Preview build\]\n {4}types: \[completed\]\n\n/m,
  );
});

test("the pull request's code builds with no secret, and the token runs only main's code", () => {
  assert.doesNotMatch(BUILD_WORKFLOW, /secrets\.|environment:/);
  assert.doesNotMatch(readJobText(WORKFLOW, "sync"), /^ +ref:/m);
  for (const workflow of [BUILD_WORKFLOW, WORKFLOW]) {
    assert.doesNotMatch(workflow, /workflow_dispatch|pull_request_target/);
  }
  const environments = [...WORKFLOW.matchAll(/^ +environment: (.+)$/gm)].map(([, name]) => name);
  assert.deepEqual(environments, ["preview"]);
});

test("the Preview workflow installs wrangler before the token, and hands every app's secrets to the sync", () => {
  const sync = readJobText(WORKFLOW, "sync");
  const install = sync.match(/^ {6}- run: npm install --no-save --ignore-scripts wrangler@(.+)$/m);
  assert.match(install?.[1] ?? "", /^\d+\.\d+\.\d+$/);
  const steps = sync.split(/^ {6}- /m);
  const installStep = steps.find((step) => step.includes("wrangler@"));
  assert.doesNotMatch(installStep ?? "", /secrets\./);
  assert.ok(steps.indexOf(installStep ?? "") < steps.findIndex((step) => step.includes("TOKEN")));
  for (const app of listApps()) {
    for (const secret of [
      `${app.toUpperCase()}_BETA_PAGE_URL`,
      `${app.toUpperCase()}_PREVIEW_HOST`,
    ]) {
      assert.match(sync, new RegExp(`^ {10}${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}$`, "m"));
    }
  }
});
