import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { API, deploy, deployCheckedRelease, deployRelease } from "../worker/deploy.mjs";
import { checkAppPage } from "../worker/check-page.mjs";

const VERIFIED = "1".repeat(40);
const UNVERIFIED = "2".repeat(40);
const NEXT = "3".repeat(40);
const WORKERS = ["mlb", "wnba"];

function createReleaseFixture(
  context,
  {
    hasFailedUpload = false,
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
  const errors = [];
  const lookups = [];
  let uploads = 0;
  const roots = { servicesRoot: pathToFileURL(join(folder, "no-services/")) };
  /** @type {typeof fetch} */
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    const name = url.pathname.match(/\/scripts\/([^/]+)/)?.[1] ?? "";
    if (!String(input).startsWith(API)) {
      const commit = live.get(url.hostname.split(".")[0]);
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
            CLOUDFLARE_ACCOUNT_ID: "acct123",
            CLOUDFLARE_WORKERS_SUBDOMAIN: "example-subdomain",
            MLB_PAGE_URL: "https://mlb-app.example-subdomain.workers.dev/k3y/",
          },
          fetchImpl,
          findChanges: (since) => [
            ...(hasFailedUpload && since === VERIFIED ? ["apps/mlb/page/styles.css"] : []),
            ...(settings.commit === NEXT ? nextChanges : []),
          ],
          isEarlier: () => false,
          pause: async () => {},
          log: () => {},
          checkPage: (settings) => {
            checked.push(settings.app);
            return settings.app === "mlb"
              ? checkAppPage(settings)
              : Promise.resolve({ status: "drawn" });
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
