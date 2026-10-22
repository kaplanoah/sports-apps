import test from "node:test";
import assert from "node:assert/strict";
import { listApps } from "../worker/apps.mjs";
import {
  deletePreviews,
  deployPreviews,
  describePreview,
  listPreviewedApps,
  namePreview,
  readPreviewAccess,
  setPreviewSecrets,
} from "../worker/preview.mjs";
import { createFakeCloudflare } from "./fake-cloudflare.js";
import { readRepoFile } from "./repo-files.js";

const API = "https://api.cloudflare.com/client/v4";
const BASE = "b".repeat(40);
const COMMIT = "c".repeat(40);
const ENV = {
  CLOUDFLARE_ACCOUNT_ID: "acct123",
  GITHUB_REPOSITORY: "owner/sports-apps",
  GH_TOKEN: "token",
  ACCESS_CODE: "code",
  MLB_BETA_APP_KEY: "k3y",
  WNBA_BETA_APP_KEY: "k3y",
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

test("each app's previews declare every binding its beta Worker does, with the same settings", () => {
  for (const app of listApps()) {
    const sections = readAppSections(app);
    const betaSections = [...sections].filter(
      ([header]) => /^\[{1,2}env\.beta\./.test(header) && !header.includes(".previews."),
    );
    assert.ok(betaSections.length >= 3, app);
    for (const [header, settings] of betaSections) {
      const previewHeader = header.replace("env.beta.", "env.beta.previews.");
      assert.equal(sections.get(previewHeader), settings, `${app}: ${previewHeader}`);
    }
  }
});

test("each app's previews bind beta's services, never production's, and have no workers.dev address", () => {
  for (const app of listApps()) {
    const sections = readAppSections(app);
    assert.match(
      sections.get("[[env.beta.previews.services]]") ?? "",
      /^service = "accounts-beta"$/m,
    );
    const previewServices = [...sections]
      .filter(([header]) => header.includes(".previews.services"))
      .flatMap(([, settings]) => [...settings.matchAll(/^service = "([^"]+)"$/gm)])
      .map(([, service]) => service);
    assert.ok(previewServices.length, app);
    assert.deepEqual(
      previewServices.filter((service) => !service.endsWith("-beta")),
      [],
      app,
    );
    assert.match(sections.get("[env.beta]") ?? "", /^preview_urls = false$/m, app);
  }
});

test("a preview is named for its pull request, and opens at that name under its app's host", () => {
  assert.equal(namePreview(12), "pr-12");
  assert.deepEqual(readPreviewAccess("mlb", 12, ENV), {
    host: "mlb-previews.example.com",
    pageUrl: "https://pr-12.mlb-previews.example.com/k3y/",
    accessCode: "code",
  });
  assert.equal(
    readPreviewAccess("wnba", 12, { ...ENV, WNBA_BETA_APP_KEY: "wnba-k3y" }).pageUrl,
    "https://pr-12.wnba-previews.example.com/wnba-k3y/",
  );
  assert.throws(
    () => readPreviewAccess("wnba", 12, { ...ENV, WNBA_PREVIEW_HOST: "" }),
    /^Error: Set the preview environment's WNBA_PREVIEW_HOST\.$/,
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
  if (args.join(" ") === "rev-parse HEAD") return COMMIT;
  throw new Error(`unexpected git ${args.join(" ")}`);
};

/**
 * GitHub's comments on the pull request, starting with these, and each call it was sent.
 * @param {{ id: number, body: string }[]} [comments]
 */
function createFakeGitHub(comments = []) {
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body });
    return new Response(JSON.stringify(init?.method === "GET" ? comments : {}));
  };
  return { fetchImpl, calls };
}

/** @param {{ log: string[], github: ReturnType<typeof createFakeGitHub> }} seen */
const listShown = ({ log, github }) => [...log, ...github.calls.map((call) => call.body ?? "")];

test("a pull request's preview is built as beta, uploaded under its name, opened, and announced without its address", async () => {
  const built = [];
  const uploads = [];
  const opened = [];
  const log = [];
  const github = createFakeGitHub();
  const apps = await deployPreviews({
    pullRequest: "12",
    base: BASE,
    git: createFakeGit(["apps/mlb/page/styles.css"]),
    buildApp: async (app, options) => {
      built.push([app, options]);
      return { output: "", size: 0 };
    },
    wrangler: async (args) => {
      uploads.push(args);
      return JSON.stringify({ preview: { urls: [`https://pr-12.${ENV.MLB_PREVIEW_HOST}`] } });
    },
    checkPage: async ({ access, commit, attempts }) => {
      opened.push({ access, commit, attempts });
      return { status: "drawn", reason: "" };
    },
    fetchImpl: github.fetchImpl,
    env: ENV,
    log: (line) => log.push(line),
  });

  assert.deepEqual(apps, ["mlb"]);
  assert.deepEqual(built, [["mlb", { channel: "beta" }]]);
  assert.deepEqual(uploads, [
    [
      "preview",
      "--config",
      "apps/mlb/worker/wrangler.toml",
      "--env",
      "beta",
      "--name",
      "pr-12",
      "--json",
    ],
  ]);
  assert.deepEqual(opened, [
    {
      access: { pageUrl: "https://pr-12.mlb-previews.example.com/k3y/", accessCode: "code" },
      commit: COMMIT,
      attempts: 6,
    },
  ]);
  assert.deepEqual(log, ["mlb preview pr-12: uploaded", "mlb preview check: drawn"]);
  const posts = github.calls.filter((call) => call.method === "POST");
  assert.deepEqual(
    posts.map((call) => [call.url, JSON.parse(call.body).body]),
    [
      [
        "https://api.github.com/repos/owner/sports-apps/issues/12/comments",
        describePreview({ pullRequest: "12", apps: ["mlb"], state: "up", commit: COMMIT }),
      ],
    ],
  );
  for (const shown of listShown({ log, github })) {
    for (const host of HOSTS) assert.ok(!shown.includes(host), shown);
  }
});

test("a preview that doesn't open fails the run, saying why without its address", async () => {
  const log = [];
  const github = createFakeGitHub([
    { id: 7, body: describePreview({ pullRequest: 12, apps: ["mlb"], state: "deleted" }) },
  ]);
  await assert.rejects(
    deployPreviews({
      pullRequest: 12,
      base: BASE,
      git: createFakeGit(["apps/mlb/page/styles.css"]),
      buildApp: async () => ({ output: "", size: 0 }),
      wrangler: async () => "{}",
      checkPage: async () => ({
        status: "broken",
        reason: `no games drawn at https://pr-12.${ENV.MLB_PREVIEW_HOST}/`,
      }),
      fetchImpl: github.fetchImpl,
      env: ENV,
      log: (line) => log.push(line),
    }),
    /^Error: The preview didn't open for mlb\.$/,
  );

  assert.deepEqual(log.slice(-1), [
    "mlb preview check: broken: no games drawn at https://pr-12.<preview host>/",
  ]);
  const patches = github.calls.filter((call) => call.method === "PATCH");
  assert.deepEqual(
    patches.map((call) => [call.url, JSON.parse(call.body).body]),
    [
      [
        "https://api.github.com/repos/owner/sports-apps/issues/comments/7",
        describePreview({ pullRequest: 12, apps: ["mlb"], state: "broken", commit: COMMIT }),
      ],
    ],
  );
  for (const shown of listShown({ log, github })) {
    for (const host of HOSTS) assert.ok(!shown.includes(host), shown);
  }
});

test("an upload wrangler refuses fails the run, saying why without the address", async () => {
  const github = createFakeGitHub();
  const refusal = Object.assign(new Error("Command failed"), {
    stderr: `Uploading\nCouldn't route pr-12.${ENV.MLB_PREVIEW_HOST}\n`,
  });
  await assert.rejects(
    deployPreviews({
      pullRequest: 12,
      base: BASE,
      git: createFakeGit(["apps/mlb/worker/src/store.js"]),
      buildApp: async () => ({ output: "", size: 0 }),
      wrangler: async () => {
        throw refusal;
      },
      fetchImpl: github.fetchImpl,
      env: ENV,
      log: () => {},
    }),
    (/** @type {Error} */ error) => {
      assert.equal(
        error.message,
        "mlb preview failed: Uploading\nCouldn't route pr-12.<preview host>",
      );
      return true;
    },
  );
});

test("a pull request that changes no app's Worker gets no preview, and says so", async () => {
  const github = createFakeGitHub();
  const apps = await deployPreviews({
    pullRequest: 12,
    base: BASE,
    git: createFakeGit(["README.md"]),
    buildApp: async () => assert.fail("built"),
    wrangler: async () => assert.fail("uploaded"),
    fetchImpl: github.fetchImpl,
    env: ENV,
    log: () => {},
  });
  assert.deepEqual(apps, []);
  const posts = github.calls.filter((call) => call.method === "POST");
  assert.match(JSON.parse(posts[0].body).body, /no preview `pr-12`/);
});

test("a pull request's previews are deleted from every app's beta Worker, one that's gone too", async () => {
  const github = createFakeGitHub();
  const deletes = [];
  const log = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    if (!String(url).startsWith(API)) return github.fetchImpl(url, init);
    deletes.push([init?.method, String(url)]);
    const isGone = String(url).includes("wnba-app-beta");
    return new Response(JSON.stringify({ success: !isGone, result: {} }), {
      status: isGone ? 404 : 200,
    });
  };
  await deletePreviews({ pullRequest: 12, fetchImpl, env: ENV, log: (line) => log.push(line) });

  assert.deepEqual(deletes, [
    ["DELETE", `${API}/accounts/acct123/workers/workers/mlb-app-beta/previews/pr-12`],
    ["DELETE", `${API}/accounts/acct123/workers/workers/wnba-app-beta/previews/pr-12`],
  ]);
  assert.deepEqual(log, ["mlb preview pr-12: ok", "wnba preview pr-12: none"]);
  const posts = github.calls.filter((call) => call.method === "POST");
  assert.match(JSON.parse(posts[0].body).body, /^<!-- preview -->\nPreview `pr-12` is deleted/);
});

test("each beta Worker's previews get beta's key and code and a signing key of their own, never printed", async () => {
  const cloudflare = createFakeCloudflare();
  const log = [];
  let count = 0;
  await setPreviewSecrets({
    fetchImpl: cloudflare.fetchImpl,
    env: { ...ENV, MLB_BETA_APP_KEY: "mlb-k3y", WNBA_BETA_APP_KEY: "wnba-k3y" },
    log: (line) => log.push(line),
    makeSigningKey: () => `signing-${(count += 1)}`,
  });

  const secretFor = (key, text) => [key, { type: "secret_text", text }];
  assert.deepEqual(
    cloudflare.calls.map(({ url, init }) => [
      init.method,
      url,
      init.headers["content-type"],
      JSON.parse(init.body),
    ]),
    [
      ["mlb", "mlb-k3y", "signing-1"],
      ["wnba", "wnba-k3y", "signing-2"],
    ].map(([app, appKey, signingKey]) => [
      "PATCH",
      `${API}/accounts/acct123/workers/workers/${app}-app-beta`,
      "application/merge-patch+json",
      {
        previews_base_config: {
          env: Object.fromEntries([
            secretFor("APP_KEY", appKey),
            secretFor("ACCESS_CODE", "code"),
            secretFor("ACCESS_SIGNING_KEY", signingKey),
          ]),
        },
      },
    ]),
  );
  assert.deepEqual(log, ["mlb preview secrets: ok", "wnba preview secrets: ok"]);
});

test("no beta Worker's previews get secrets while one is missing", async () => {
  /** @type {[NodeJS.ProcessEnv, RegExp][]} */
  const refusals = [
    [{ ACCESS_CODE: "" }, /^Error: Set the preview environment's ACCESS_CODE\.$/],
    [{ WNBA_BETA_APP_KEY: "" }, /^Error: Set the preview environment's WNBA_BETA_APP_KEY\.$/],
  ];
  for (const [missing, refusal] of refusals) {
    const cloudflare = createFakeCloudflare();
    await assert.rejects(
      setPreviewSecrets({
        fetchImpl: cloudflare.fetchImpl,
        env: { ...ENV, ...missing },
        log: () => {},
      }),
      refusal,
    );
    assert.deepEqual(cloudflare.calls, []);
  }
});

test("a session can't make, delete, or give secrets to a preview itself", () => {
  const { permissions } = JSON.parse(readRepoFile(".claude/settings.json"));
  for (const rule of ["Bash(node worker/preview.mjs)", "Bash(node worker/preview.mjs *)"]) {
    assert.ok(permissions.deny.includes(rule), rule);
  }
});

const WORKFLOW = readRepoFile(".github/workflows/preview.yml");

/** @param {string} job */
function readJobText(job) {
  const text = WORKFLOW.match(new RegExp(`^ {2}${job}:\\n(?:(?: {4}.*)?\\n)*`, "m"))?.[0];
  assert.ok(text, job);
  return text;
}

/**
 * A job's `if:`, as a test over the event's context, read by the few rules of GitHub's
 * expressions the workflow uses.
 * @param {string} job
 */
function readJobCondition(job) {
  const text = readJobText(job);
  const folded = text.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m)?.[1];
  const expression = folded
    ? folded
        .split("\n")
        .map((line) => line.trim())
        .join(" ")
    : text.match(/^ {4}if: (.+)$/m)?.[1];
  assert.ok(expression, job);
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
  event_name: "pull_request",
  repository: "owner/sports-apps",
  event: {
    action,
    label: label ? { name: label } : undefined,
    pull_request: {
      labels: labels.map((name) => ({ name })),
      head: { repo: { full_name: isFork ? "someone/sports-apps" : "owner/sports-apps" } },
    },
  },
});

/** @param {ReturnType<typeof describeEvent> | { event_name: string }} github */
const listRunJobs = (github) =>
  ["deploy", "delete", "set-secrets"].filter((job) => readJobCondition(job)(github, contains));

test("the Preview workflow makes a preview only for a pull request labeled preview", () => {
  /** @type {[Parameters<typeof describeEvent>[0], string[]][]} */
  const cases = [
    [{ action: "labeled", label: "preview", labels: ["preview"] }, ["deploy"]],
    [{ action: "labeled", label: "beta", labels: ["beta", "preview"] }, []],
    [{ action: "synchronize", labels: ["preview"] }, ["deploy"]],
    [{ action: "reopened", labels: ["preview"] }, ["deploy"]],
    [{ action: "synchronize", labels: ["beta"] }, []],
    [{ action: "opened", labels: ["preview"] }, []],
    [{ action: "unlabeled", label: "preview" }, ["delete"]],
    [{ action: "unlabeled", label: "beta", labels: ["preview"] }, []],
    [{ action: "closed", labels: ["preview"] }, ["delete"]],
    [{ action: "closed", labels: [] }, []],
  ];
  for (const [event, jobs] of cases) {
    assert.deepEqual(listRunJobs(describeEvent(event)), jobs, JSON.stringify(event));
    assert.deepEqual(listRunJobs(describeEvent({ ...event, isFork: true })), [], "a fork's");
  }
  assert.deepEqual(listRunJobs({ event_name: "workflow_dispatch" }), ["set-secrets"]);
  assert.match(WORKFLOW, /types: \[labeled, unlabeled, synchronize, reopened, closed\]/);
});

test("the Preview workflow uses only the preview environment, and installs wrangler before the token", () => {
  const environments = [...WORKFLOW.matchAll(/^ +environment: (.+)$/gm)].map(([, name]) => name);
  assert.deepEqual(environments, ["preview", "preview", "preview"]);
  const deploy = readJobText("deploy");
  const install = deploy.match(
    /^ {6}- run: npm install --no-save --ignore-scripts wrangler@(.+)$/m,
  );
  assert.match(install?.[1] ?? "", /^\d+\.\d+\.\d+$/);
  const steps = deploy.split(/^ {6}- /m);
  const installStep = steps.find((step) => step.includes("wrangler@"));
  assert.doesNotMatch(installStep ?? "", /secrets\./);
  assert.ok(steps.indexOf(installStep ?? "") < steps.findIndex((step) => step.includes("TOKEN")));
});
