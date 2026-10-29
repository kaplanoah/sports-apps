import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareNativeAdmission,
  launchNativeAdmission,
  collectNativeAdmission,
  finishUnstartedAdmission,
  superviseNativeAdmission,
} from "../worker/codex-rate-runtime.mjs";
import { readNativeRatePolicyHash } from "../worker/codex-rate-policy.mjs";

function createStartupFixture(t) {
  const folder = mkdtempSync(join(tmpdir(), "native-rate-startup-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const name of ["private", "public"]) mkdirSync(join(folder, name));
  writeFileSync(join(folder, "private/runtime.mjs"), "export {};\n");
  writeFileSync(join(folder, "public/hook.sh"), "example");
  const config = {
    version: 1,
    repository: "example/repo",
    run: 30,
    job: 7,
    source: "a".repeat(40),
    policy: readNativeRatePolicyHash(),
    notBefore: 0,
    scanSince: 0,
    activeRuns: [30],
    port: 12345,
    namespaces: ["1", "1"],
  };
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_OS: "Linux",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "30",
    GITHUB_REPOSITORY: "example/repo",
    GITHUB_REPOSITORY_OWNER: "example",
    GITHUB_REPOSITORY_ID: "9",
    GITHUB_SHA: config.source,
    PORTION: "1",
    GH_TOKEN: "fake-github-token",
    GITHUB_OUTPUT: join(folder, "outputs"),
  };
  const runtime = Buffer.from("export {};\n");
  writeFileSync(join(folder, "runtime.mjs"), runtime);
  writeFileSync(
    join(folder, "manifest.json"),
    JSON.stringify({
      version: 1,
      ...config,
      portion: "1",
      runtimeSHA256: createHash("sha256").update(runtime).digest("hex"),
    }),
  );
  writeFileSync(join(folder, "public/identity.json"), JSON.stringify(config));
  const readConfiguration = () => config;
  const stat = () => ({ uid: 0, mode: 0o444, isSymbolicLink: () => false });
  return { folder, config, env, readConfiguration, stat };
}

test("pre-model preparation enforces its wait budget and publishes only the protected root outputs", async (t) => {
  const fixture = createStartupFixture(t);
  const { folder, config, env } = fixture;
  let spawned = 0;
  const waits = [];
  const options = {
    readAdmission: async () => ({ ...config, notBefore: 1500 }),
    now: () => 1000,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    selectPort: async () => 12345,
    spawnRoot(command, args, settings) {
      spawned++;
      assert.equal(command, "sudo");
      assert.ok(args.includes("-i"));
      assert.ok(args.includes("--disable-sigusr1"));
      assert.equal(JSON.stringify({ args, settings }).includes("fake-github-token"), false);
      return {
        status: 0,
        stdout: JSON.stringify({ folder: "/tmp/codex-native-rate-Example", port: 12345 }),
      };
    },
  };
  await prepareNativeAdmission(folder, env, options);
  assert.deepEqual(waits, [500]);
  assert.equal(spawned, 1);
  assert.equal(
    readFileSync(env.GITHUB_OUTPUT, "utf8"),
    [
      "endpoint=http://127.0.0.1:12345/v1/responses",
      "hook=/tmp/codex-native-rate-Example/public/hook.sh",
      "collector=/tmp/codex-native-rate-Example/public/runtime.mjs",
      "folder=/tmp/codex-native-rate-Example",
      "artifact=codex-rate-handoff-7",
      "result=/tmp/codex-native-rate-Example/public/cooldown.json",
      "",
    ].join("\n"),
  );
  await assert.rejects(
    prepareNativeAdmission(folder, env, {
      ...options,
      readAdmission: async () => ({ ...config, notBefore: 999999 }),
    }),
    /wait budget/,
  );
  assert.equal(spawned, 1);
  for (const result of [
    { status: 1 },
    { status: 0, stdout: "{}" },
    { status: 0, stdout: '{"folder":"/tmp/foreign","port":12345}' },
    { status: 0, stdout: '{"folder":"/tmp/codex-native-rate-Example","port":54321}' },
  ])
    await assert.rejects(
      prepareNativeAdmission(folder, env, { ...options, spawnRoot: () => result }),
    );
});

test("launch authenticates ready job, port and parent and fails on absent parent or startup timeout", async (t) => {
  const { folder, config } = createStartupFixture(t);
  const parent = { pid: 42, start: "17", state: "S" };
  const ready = { passed: true, job: config.job, port: config.port, parent: parent.pid };
  const path = join(folder, "public/ready.json");
  const options = {
    inspect: () => parent,
    spawnRoot(command, args) {
      assert.equal(command, "sudo");
      assert.ok(args.includes("-i"));
      return Object.assign(new EventEmitter(), { unref() {} });
    },
  };
  writeFileSync(path, JSON.stringify(ready));
  await launchNativeAdmission(folder, "42", options);
  for (const changed of [{ passed: false }, { job: 8 }, { port: 54321 }, { parent: 43 }]) {
    writeFileSync(path, JSON.stringify({ ...ready, ...changed }));
    await assert.rejects(launchNativeAdmission(folder, "42", options), /readiness mismatch/);
  }
  await assert.rejects(
    launchNativeAdmission(folder, "42", { ...options, inspect: () => null }),
    /parent/,
  );
  rmSync(path);
  let clock = 1000;
  await assert.rejects(
    launchNativeAdmission(folder, "42", {
      ...options,
      now: () => clock,
      wait: async () => {
        clock += 10001;
      },
    }),
    /ready/,
  );
});

test("a bind failure finalizes honest not-started quota, removes controls and still fails startup", async (t) => {
  const fixture = createStartupFixture(t);
  let restored = 0;
  await assert.rejects(
    superviseNativeAdmission(
      fixture.folder,
      { pid: 42 },
      {
        readConfiguration: fixture.readConfiguration,
        now: () => 1000,
        restore: () => {
          restored++;
        },
        start: async () => {
          throw Object.assign(new Error("bind failed"), { code: "EADDRINUSE" });
        },
      },
    ),
    /bind failed/,
  );
  const record = JSON.parse(readFileSync(join(fixture.folder, "public/cooldown.json"), "utf8"));
  assert.equal(restored, 1);
  assert.equal(record.termination, "not-started");
  assert.equal(record.requests, 0);
  assert.equal(record.observedTokens, null);
  assert.equal(record.notBefore, 61000);
  assert.equal(existsSync(join(fixture.folder, "private")), false);
  assert.equal(existsSync(join(fixture.folder, "public/failed.json")), true);
  await collectNativeAdmission(fixture.folder, fixture.env, { stat: fixture.stat });
});

test("startup restoration failure always signals failure and never finalizes successful quota", async (t) => {
  const fixture = createStartupFixture(t);
  await assert.rejects(
    superviseNativeAdmission(
      fixture.folder,
      { pid: 42 },
      {
        readConfiguration: fixture.readConfiguration,
        now: () => 1000,
        restore: () => {
          throw new Error("restoration failed");
        },
        start: async () => {
          throw new Error("bind failed");
        },
      },
    ),
  );
  assert.equal(existsSync(join(fixture.folder, "public/failed.json")), true);
  assert.equal(existsSync(join(fixture.folder, "public/cooldown.json")), false);
  assert.equal(existsSync(join(fixture.folder, "private")), false);
});

test("collection's unstarted fallback verifies actual identity, root ownership and read-only metadata", async (t) => {
  const fixture = createStartupFixture(t);
  let fallbacks = 0;
  const options = {
    stat: fixture.stat,
    spawnRoot(command, args) {
      fallbacks++;
      assert.equal(command, "sudo");
      assert.ok(args.includes("not-started"));
      finishUnstartedAdmission(fixture.folder, {
        readConfiguration: fixture.readConfiguration,
        restore: () => {},
        now: () => 1000,
      });
      return { status: 0 };
    },
  };
  await collectNativeAdmission(fixture.folder, fixture.env, options);
  await collectNativeAdmission(fixture.folder, fixture.env, options);
  assert.equal(fallbacks, 1);
  for (const changed of [{ uid: 1 }, { mode: 0o666 }, { isSymbolicLink: () => true }])
    await assert.rejects(
      collectNativeAdmission(fixture.folder, fixture.env, {
        ...options,
        stat: () => ({ ...fixture.stat(), ...changed }),
      }),
      /trusted boundary/,
    );
  await assert.rejects(
    collectNativeAdmission(fixture.folder, { ...fixture.env, GITHUB_RUN_ID: "31" }, options),
  );
  writeFileSync(join(fixture.folder, "public/ready.json"), "{}");
  assert.throws(
    () =>
      finishUnstartedAdmission(fixture.folder, { readConfiguration: fixture.readConfiguration }),
    /active/,
  );
});

test("a successful guardian closes and removes private controls before finalizing numeric state", async (t) => {
  const fixture = createStartupFixture(t);
  let closed = false;
  await superviseNativeAdmission(
    fixture.folder,
    { pid: 42 },
    {
      readConfiguration: fixture.readConfiguration,
      now: () => 1000,
      restore: () => {},
      start: async () => ({
        address: { port: fixture.config.port },
        close: async () => {
          closed = true;
        },
        readFinalState: () => {
          assert.equal(closed, true);
          assert.equal(existsSync(join(fixture.folder, "private")), false);
          return {
            requests: 1,
            reservedTokens: 100,
            observedTokens: 15,
            unavailable: 0,
            queuedMs: 20,
            feedbackFailed: false,
            notBefore: 61000,
          };
        },
      }),
      monitor: async ({ stop, finalize }) => {
        assert.equal(existsSync(join(fixture.folder, "public/ready.json")), true);
        await stop();
        await finalize({ termination: "parent-exited", completedAt: 1000 });
      },
    },
  );
  await collectNativeAdmission(fixture.folder, fixture.env, { stat: fixture.stat });
  assert.equal(existsSync(join(fixture.folder, "public/failed.json")), false);
});

test("a close failure after readiness always retains a failure marker without publishing quota", async (t) => {
  const fixture = createStartupFixture(t);
  await assert.rejects(
    superviseNativeAdmission(
      fixture.folder,
      { pid: 42 },
      {
        readConfiguration: fixture.readConfiguration,
        now: () => 1000,
        restore: () => {},
        start: async () => ({
          address: { port: fixture.config.port },
          close: async () => {
            throw new Error("close failed");
          },
        }),
        monitor: async ({ stop }) => {
          await stop();
        },
      },
    ),
  );
  assert.equal(existsSync(join(fixture.folder, "public/failed.json")), true);
  assert.equal(existsSync(join(fixture.folder, "public/cooldown.json")), false);
  assert.equal(existsSync(join(fixture.folder, "private")), false);
});

test("failed unstarted cleanup and a missing final state reject without retrying cleanup", async (t) => {
  const fixture = createStartupFixture(t);
  let attempts = 0;
  await assert.rejects(
    collectNativeAdmission(fixture.folder, fixture.env, {
      spawnRoot: () => {
        attempts++;
        return { status: 1 };
      },
    }),
    /startup cleanup failed/,
  );
  assert.equal(attempts, 1);
  writeFileSync(join(fixture.folder, "public/ready.json"), "{}");
  let clock = 1000;
  await assert.rejects(
    collectNativeAdmission(fixture.folder, fixture.env, {
      now: () => clock,
      wait: async () => {
        clock += 10001;
      },
    }),
    /finalize/,
  );
});
