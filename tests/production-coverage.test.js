import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { API, deploy, deployCheckedRelease, deployRelease } from "../worker/deploy.mjs";
import { readDeployedMain } from "../worker/production-coverage.mjs";
import { checkAppPage } from "../worker/check-page.mjs";

const VERIFIED = "1".repeat(40);
const UNVERIFIED = "2".repeat(40);
const NEXT = "3".repeat(40);
const WORKERS = ["mlb", "wnba"];

function createReleaseFixture(
  context,
  {
    hasFailedUpload = false,
    failedChanges = ["apps/mlb/page/styles.css"],
    blockedWorkers = ["mlb"],
    isEarlier = /** @type {(earlier: string, later: string) => boolean} */ (() => false),
    nextChanges = [],
    readViaGitHub = false,
    lookupUnavailable = false,
  } = {},
) {
  const folder = mkdtempSync(join(tmpdir(), "production-coverage-"));
  context.after(() => rmSync(folder, { recursive: true, force: true }));
  const output = join(folder, "output");
  writeFileSync(output, "");
  const live = new Map(WORKERS.map((worker) => [`${worker}-app`, VERIFIED]));
  const checked = [];
  const pageCommits = [];
  const blocked = new Set(hasFailedUpload ? blockedWorkers : []);
  const workerAnswers = new Map();
  const pageResults = new Map();
  let attempt = "1";
  const errors = [];
  const lookups = [];
  let uploads = 0;
  const roots = { servicesRoot: pathToFileURL(join(folder, "no-services/")) };
  /** @type {typeof fetch} */
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    const name = url.pathname.match(/\/scripts\/([^/]+)/)?.[1] ?? "";
    if (!String(input).startsWith(API)) {
      const name = url.hostname.split(".")[0];
      const commit = workerAnswers.get(name) ?? live.get(name);
      assert.ok(commit);
      return new Response("", { headers: { "x-release-commit": commit.slice(0, 7) } });
    }
    let result = {};
    if (url.pathname.endsWith("/deployments"))
      result = { deployments: [{ versions: [{ version_id: "v-live", percentage: 100 }] }] };
    if (url.pathname.endsWith("/versions/v-live"))
      result = { annotations: { "workers/message": live.get(name) } };
    if (url.pathname.endsWith("/workers/scripts"))
      result = WORKERS.map((worker) => ({ id: `${worker}-app`, migration_tag: "v1" }));
    if (options.method === "PUT") {
      assert.ok(options.body instanceof FormData);
      const metadata = JSON.parse(await options.body.get("metadata").text());
      live.set(name, metadata.annotations["workers/message"]);
      uploads += 1;
    }
    return Response.json({ success: true, result });
  };
  /** @type {typeof deployRelease} */
  const release = (workers, options) =>
    deployRelease(workers, {
      ...options,
      roots,
      buildWorkerImpl: async () => "export default {}",
      deployWorkerImpl: (settings) =>
        deploy({
          ...settings,
          env: {
            GITHUB_RUN_ATTEMPT: attempt,
            CLOUDFLARE_ACCOUNT_ID: "acct123",
            CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain",
            MLB_PAGE_URL: "https://mlb-app.example-subdomain.workers.dev/k3y/",
          },
          fetchImpl,
          findChanges: (since) =>
            since === settings.commit
              ? []
              : [
                  ...(hasFailedUpload && since === VERIFIED ? failedChanges : []),
                  ...(settings.commit === NEXT ? nextChanges : []),
                ],
          isEarlier,
          pause: async () => {},
          log: () => {},
          checkPage: (settings) => {
            checked.push(settings.app);
            pageCommits.push({ worker: settings.app, commit: settings.commit });
            if (blocked.has(settings.app)) return checkAppPage(settings);
            if (pageResults.has(settings.app))
              return Promise.resolve(pageResults.get(settings.app));
            return Promise.resolve(
              settings.commit === live.get(`${settings.app}-app`)
                ? { status: "drawn" }
                : { status: "broken", reason: "the page is at another release" },
            );
          },
        }),
      logError: (message) => errors.push(message),
    });
  /** @type {typeof fetch} */
  const readReceipt = async (input) => {
    const url = String(input);
    lookups.push(url);
    if (lookupUnavailable) return new Response("", { status: 403 });
    if (url.includes("/actions/workflows/deploy.yml/runs"))
      return Response.json({
        workflow_runs: [
          {
            id: 7,
            path: ".github/workflows/deploy.yml",
            head_branch: "main",
            conclusion: "success",
          },
        ],
      });
    assert.ok(url.includes("/actions/runs/7/artifacts"));
    return Response.json({
      artifacts: [{ name: `production-checked-${VERIFIED}`, expired: false }],
    });
  };
  /** @param {string} commit @param {string | null} [previous] @param {string[]} [workers] */
  const check = (commit, previous = VERIFIED, workers = WORKERS) =>
    deployCheckedRelease(
      workers,
      { channel: "production", commit, newer: null },
      {
        env: { GITHUB_REPOSITORY: "example/repo", GITHUB_OUTPUT: output },
        deploy: release,
        ...(readViaGitHub ? {} : { readCheckedCommit: async () => previous }),
        fetchImpl: readReceipt,
        requiredWorkers: WORKERS,
      },
    );
  return {
    check,
    live,
    checked,
    pageCommits,
    workerAnswers,
    pageResults,
    repairPages: () => blocked.clear(),
    retry: () => {
      attempt = "2";
    },
    errors,
    lookups,
    readReceipt: () => readFileSync(output, "utf8"),
    uploads: () => uploads,
  };
}

test("a failed live upload cannot gain production coverage from docs or another app's deploy", async (context) => {
  for (const nextChanges of [["README.md"], ["apps/wnba/page/styles.css"]]) {
    const fixture = createReleaseFixture(context, { hasFailedUpload: true, nextChanges });
    assert.equal(await fixture.check(UNVERIFIED), false);
    assert.equal(fixture.live.get("mlb-app"), UNVERIFIED);
    assert.match(fixture.errors[0], /live but unverified: no ACCESS_CODE secret/);
    assert.equal(fixture.readReceipt(), "");
    assert.equal(await fixture.check(NEXT), true);
    assert.equal(fixture.readReceipt(), "");
    assert.equal(fixture.live.get("mlb-app"), UNVERIFIED);
    assert.deepEqual(fixture.checked, nextChanges[0] === "README.md" ? ["mlb"] : ["mlb", "wnba"]);
    assert.equal(fixture.uploads(), nextChanges[0] === "README.md" ? 1 : 2);
  }
});

test("fresh and inherited Worker coverage can share one receipt", async (context) => {
  const fixture = createReleaseFixture(context, { nextChanges: ["apps/wnba/page/styles.css"] });
  assert.equal(await fixture.check(NEXT), true);
  assert.equal(fixture.readReceipt(), `checked-commit=${NEXT}\n`);
  assert.equal(fixture.uploads(), 1);
  assert.deepEqual(fixture.checked, ["wnba"]);
});

test("the default receipt lookup reads GitHub and withholds unprovable inheritance", async (context) => {
  for (const lookupUnavailable of [false, true]) {
    const fixture = createReleaseFixture(context, {
      nextChanges: ["README.md"],
      readViaGitHub: true,
      lookupUnavailable,
    });
    assert.equal(await fixture.check(NEXT), true);
    assert.equal(fixture.readReceipt(), lookupUnavailable ? "" : `checked-commit=${NEXT}\n`);
    assert.equal(fixture.lookups.length, lookupUnavailable ? 1 : 2);
    assert.equal(fixture.uploads(), 0);
    assert.deepEqual(fixture.checked, []);
  }
});

test("equivalent verified runtime inherits coverage without uploading or opening pages", async (context) => {
  const fixture = createReleaseFixture(context, { nextChanges: ["README.md"] });
  assert.equal(await fixture.check(NEXT), true);
  assert.equal(fixture.readReceipt(), `checked-commit=${NEXT}\n`);
  assert.equal(fixture.uploads(), 0);
  assert.deepEqual(fixture.checked, []);
});

test("missing prior coverage or a partial selection cannot create a global receipt", async (context) => {
  for (const { previous, workers } of [
    { previous: null, workers: WORKERS },
    { previous: VERIFIED, workers: ["mlb"] },
  ]) {
    const fixture = createReleaseFixture(context, { nextChanges: ["README.md"] });
    assert.equal(await fixture.check(NEXT, previous, workers), true);
    assert.equal(fixture.readReceipt(), "");
    assert.equal(fixture.uploads(), 0);
    assert.deepEqual(fixture.checked, []);
  }
});

const isEarlierKnownCommit = (earlier, later) =>
  [VERIFIED, UNVERIFIED, NEXT].indexOf(earlier) < [VERIFIED, UNVERIFIED, NEXT].indexOf(later);

test("an explicit current-run retry recovers a failed shared release after a docs successor", async (context) => {
  for (const previous of [VERIFIED, null]) {
    const fixture = createReleaseFixture(context, {
      hasFailedUpload: true,
      failedChanges: ["shared/page/styles.css"],
      blockedWorkers: WORKERS,
      nextChanges: ["README.md"],
      isEarlier: isEarlierKnownCommit,
    });
    assert.equal(await fixture.check(UNVERIFIED, previous), false);
    assert.deepEqual([...fixture.live.values()], [UNVERIFIED, UNVERIFIED]);
    assert.equal(fixture.readReceipt(), "");
    assert.equal(await fixture.check(NEXT, previous), true);
    assert.equal(fixture.readReceipt(), "");
    assert.equal(fixture.checked.length, 2);
    fixture.repairPages();
    fixture.retry();
    assert.equal(await fixture.check(NEXT, previous), true);
    assert.equal(fixture.readReceipt(), `checked-commit=${NEXT}\n`);
    assert.equal(fixture.uploads(), 2);
    assert.deepEqual(
      fixture.pageCommits.slice(-2),
      WORKERS.map((worker) => ({ worker, commit: UNVERIFIED })),
    );
  }
});

test("recovery checks each app's recorded release without uploading it again", async (context) => {
  const fixture = createReleaseFixture(context, {
    hasFailedUpload: true,
    nextChanges: ["apps/wnba/page/styles.css"],
    isEarlier: isEarlierKnownCommit,
  });
  assert.equal(await fixture.check(UNVERIFIED), false);
  assert.equal(await fixture.check(NEXT), true);
  assert.equal(fixture.readReceipt(), "");
  fixture.repairPages();
  fixture.retry();
  assert.equal(await fixture.check(NEXT), true);
  assert.equal(fixture.readReceipt(), `checked-commit=${NEXT}\n`);
  assert.equal(fixture.uploads(), 2);
  assert.deepEqual(fixture.pageCommits.slice(-2), [
    { worker: "mlb", commit: UNVERIFIED },
    { worker: "wnba", commit: NEXT },
  ]);
});

test("failed recovery cannot upload, roll back or record unchecked runtime", async (context) => {
  for (const failure of ["worker", "page", "unchecked", "open"]) {
    const fixture = createReleaseFixture(context, {
      hasFailedUpload: true,
      nextChanges: ["README.md"],
      isEarlier: isEarlierKnownCommit,
    });
    assert.equal(await fixture.check(UNVERIFIED), false);
    fixture.repairPages();
    fixture.retry();
    if (failure === "worker") fixture.workerAnswers.set("mlb-app", VERIFIED);
    else
      fixture.pageResults.set(
        "mlb",
        failure === "page"
          ? { status: "broken", reason: "the page is at another release" }
          : failure === "unchecked"
            ? { status: "unchecked", reason: "browser unavailable" }
            : { status: "drawn", isOpenWithoutCode: true },
      );
    assert.equal(await fixture.check(NEXT), false);
    assert.equal(fixture.readReceipt(), "");
    assert.equal(fixture.uploads(), 1);
    assert.equal(fixture.live.get("mlb-app"), UNVERIFIED);
    assert.match(
      fixture.errors.at(-1),
      failure === "worker" || failure === "page"
        ? /no version was uploaded or rolled back/
        : /recorded live version is unverified/,
    );
  }
});

test("a newer unverified live version cannot inherit production coverage for an older run", async (context) => {
  for (const retry of [false, true]) {
    const fixture = createReleaseFixture(context, { isEarlier: isEarlierKnownCommit });
    fixture.live.set("mlb-app", NEXT);
    if (retry) fixture.retry();
    assert.equal(await fixture.check(UNVERIFIED), true);
    assert.equal(fixture.readReceipt(), "");
    assert.equal(fixture.uploads(), 0);
    assert.ok(!fixture.checked.includes("mlb"));
  }
});

test("production evidence ignores beta, missing receipts and displayed workflow SHAs", async () => {
  const requested = [];
  const sha = "a".repeat(40);
  const deployed = await readDeployedMain(async (path) => {
    requested.push(path);
    if (path.includes("deploy.yml/runs"))
      return {
        workflow_runs: [
          {
            id: 1,
            path: ".github/workflows/deploy.yml",
            head_branch: "beta",
            conclusion: "success",
          },
          ...[2, 3].map((id) => ({
            id,
            path: ".github/workflows/deploy.yml",
            head_branch: "main",
            conclusion: "success",
            head_sha: "b".repeat(40),
          })),
        ],
      };
    return {
      artifacts: path.includes("/3/")
        ? [{ name: `production-checked-${sha}`, expired: false }]
        : [],
    };
  });
  assert.equal(deployed, sha);
  assert.equal(
    requested.some((path) => path.includes("/1/")),
    false,
  );
  assert.equal(requested.length, 3);
  await assert.rejects(
    readDeployedMain(async () => ({ workflow_runs: [] })),
    /No successful production/,
  );
});

test("deploy evidence rejects expired or conflicting actual-target receipts", async () => {
  const run = {
    id: 1,
    path: ".github/workflows/deploy.yml",
    head_branch: "main",
    conclusion: "success",
    head_sha: "a".repeat(40),
  };
  /** @param {object[]} artifacts */
  const readWith = (artifacts) =>
    readDeployedMain(async (path) => {
      if (path.includes("deploy.yml/runs")) return { workflow_runs: [run] };
      if (path.includes("/artifacts")) return { artifacts };
      throw new Error(`Unexpected request: ${path}`);
    });
  await assert.rejects(
    readWith([{ name: `production-checked-${"a".repeat(40)}`, expired: true }]),
    /No successful production/,
  );
  await assert.rejects(readWith([]), /No successful production/);
  await assert.rejects(
    readWith([{ name: `production-checked-${"z".repeat(40)}`, expired: false }]),
    /No successful production/,
  );
  await assert.rejects(
    readWith([{ name: `not-a-valid-prefix-${"a".repeat(40)}`, expired: false }]),
    /No successful production/,
  );
  for (const size of [39, 41])
    await assert.rejects(
      readWith([{ name: `production-checked-${"a".repeat(size)}`, expired: false }]),
      /No successful production/,
    );

  await assert.rejects(
    readWith([{ name: `production-checked-${"a".repeat(40)}` }]),
    /No successful production/,
  );
  await assert.rejects(
    readWith(
      ["a", "b"].map((letter) => ({
        name: `production-checked-${letter.repeat(40)}`,
        expired: false,
      })),
    ),
    /conflicting checked commits/,
  );
});
