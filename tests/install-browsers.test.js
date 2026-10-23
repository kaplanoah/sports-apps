import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installBrowsers } from "../worker/install-browsers.mjs";

const CAN_ELEVATE =
  process.platform === "linux" &&
  process.getuid() !== 0 &&
  spawnSync("sudo", ["-n", "true"]).status === 0;

/** @param {string[]} scripts */
function createInstaller(scripts) {
  const invocations = [];
  const messages = [];
  const processes = [];
  /** @type {import("../worker/install-browsers.mjs").InstallerSpawn} */
  const spawnImpl = (command, arguments_, options) => {
    invocations.push({ command, arguments_, options });
    const child = spawn(process.execPath, ["-e", scripts[invocations.length - 1]], options);
    processes.push(child);
    return child;
  };
  return {
    invocations,
    messages,
    processes,
    options: { spawnImpl, log: (message) => messages.push(message) },
  };
}

test("the installed Playwright receives separate browser arguments without a shell", async () => {
  const installer = createInstaller(["process.exit(0)"]);
  const arguments_ = ["--with-deps", "--only-shell", "chromium", "webkit"];
  assert.equal(await installBrowsers(arguments_, installer.options), 0);
  assert.equal(installer.invocations.length, 1);
  const invocation = installer.invocations[0];
  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.arguments_[0], /node_modules\/@playwright\/test\/cli\.js$/);
  assert.deepEqual(invocation.arguments_.slice(1), ["install", ...arguments_]);
  assert.equal(invocation.options.shell, undefined);
  assert.equal(invocation.options.detached, true);
  assert.deepEqual(installer.messages, ["Browser installation: ok."]);
});

test("a recognized transport failure gets one retry", async () => {
  for (const reason of [
    "ECONNRESET",
    "EAI_AGAIN",
    "Download failed: server returned code 503",
    "E: Failed to fetch http://example.test/x.deb  503 Service Unavailable",
  ]) {
    const installer = createInstaller([
      `console.error(${JSON.stringify(reason)}); process.exit(1)`,
      "process.exit(0)",
    ]);
    assert.equal(await installBrowsers(["webkit"], installer.options), 0, reason);
    assert.equal(installer.invocations.length, 2, reason);
    assert.match(installer.messages.join("\n"), /Retrying.*once/);
  }
});

test("a second transport failure stops instead of retrying until green", async () => {
  const installer = createInstaller(Array(2).fill('console.error("ETIMEDOUT"); process.exit(2)'));
  assert.equal(await installBrowsers(["webkit"], installer.options), 2);
  assert.equal(installer.invocations.length, 2);
});

test("ordinary package progress cannot suppress a later transport retry", async () => {
  const installer = createInstaller([
    'console.log("Get:1 mirror package 1.2.403-1 [403 kB]; unsupported optional notice"); console.error("ECONNRESET"); process.exitCode = 1',
    "process.exit(0)",
  ]);
  assert.equal(await installBrowsers(["webkit"], installer.options), 0);
  assert.equal(installer.invocations.length, 2);
  assert.doesNotMatch(installer.messages.join("\n"), /permanent error/);
});

test("authentication, policy, configuration and unknown failures never retry", async () => {
  for (const reason of [
    "HTTP 401",
    "HTTP 403; HTTP 503",
    "HTTP 407",
    "certificate expired",
    "Permission denied ETIMEDOUT",
    "blocked by network policy ECONNRESET",
    "Unable to locate package",
    "unknown option",
    "unexplained failure",
    "https://example.test/builds/503/browser.zip: archive corrupt",
  ]) {
    const installer = createInstaller([
      `console.error("Error: " + ${JSON.stringify(reason)}); process.exit(1)`,
    ]);
    assert.equal(await installBrowsers(["webkit"], installer.options), 1, reason);
    assert.equal(installer.invocations.length, 1, reason);
  }
});

test("a stalled install stops at its attempt deadline without retrying", async () => {
  const installer = createInstaller(['console.error("ECONNRESET"); setInterval(() => {}, 1000)']);
  assert.equal(await installBrowsers(["webkit"], { ...installer.options, timeoutMs: 150 }), 124);
  assert.equal(installer.invocations.length, 1);
  assert.match(installer.messages.join("\n"), /0\.15-second attempt limit/);
});

test("a permanent error before the retained output tail still forbids retry", async () => {
  const installer = createInstaller([
    'console.error("HTTP 403"); setTimeout(() => { process.stderr.write("x".repeat(20000)); setTimeout(() => { console.error("ECONNRESET"); process.exitCode = 1; }, 30); }, 30)',
  ]);
  assert.equal(await installBrowsers(["webkit"], installer.options), 1);
  assert.equal(installer.invocations.length, 1);
  assert.equal(installer.messages[1].includes("HTTP 403"), false);
  assert.match(installer.messages.join("\n"), /permanent error.*403/);
});

test("deadline and cancellation stop the install's descendants", async () => {
  for (const shouldCancel of [false, true]) {
    const folder = mkdtempSync(join(tmpdir(), "browser-install-"));
    const marker = join(folder, "child-pid");
    const cancellation = new AbortController();
    const descendant = `const write = () => { require('node:fs').writeFileSync(${JSON.stringify(marker)} + '.next', process.pid + ':' + Date.now()); require('node:fs').renameSync(${JSON.stringify(marker)} + '.next', ${JSON.stringify(marker)}); }; write(); console.log("DESCENDANT READY"); setInterval(write, 30)`;
    const installer = createInstaller([
      `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' }); setInterval(() => {}, 1000)`,
    ]);
    if (shouldCancel) {
      const spawnImpl = installer.options.spawnImpl;
      installer.options.spawnImpl = (command, arguments_, options) => {
        const child = spawnImpl(command, arguments_, options);
        child.stdout.on("data", (chunk) => {
          if (chunk.toString().includes("DESCENDANT READY")) cancellation.abort();
        });
        return child;
      };
    }
    let forcedCleanup = false;
    const cleanup = setTimeout(() => {
      forcedCleanup = true;
      for (const child of installer.processes)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* The process group may have ended. */
        }
    }, 2500);
    try {
      assert.equal(
        await installBrowsers(["webkit"], {
          ...installer.options,
          timeoutMs: 1000,
          signal: cancellation.signal,
        }),
        shouldCancel ? 130 : 124,
      );
      assert.equal(forcedCleanup, false, "cleanup must not depend on the test's safety timeout");
      const stoppedAt = readFileSync(marker, "utf8");
      assert.ok(Number(stoppedAt.split(":")[0]) > 0, "the descendant started");
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(readFileSync(marker, "utf8"), stoppedAt, "the descendant must stop writing");
    } finally {
      clearTimeout(cleanup);
      for (const child of installer.processes)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* The process group may have ended. */
        }
      rmSync(folder, { recursive: true, force: true });
    }
  }
});

test("cancellation stops an active installation and launches no retry", async () => {
  const installer = createInstaller(['console.error("ECONNRESET"); setInterval(() => {}, 1000)']);
  const cancellation = new AbortController();
  const pending = installBrowsers(["webkit"], {
    ...installer.options,
    signal: cancellation.signal,
  });
  cancellation.abort();
  assert.equal(await pending, 130);
  assert.equal(installer.invocations.length, 1);
  assert.match(installer.messages.join("\n"), /cancelled/);
});

test(
  "dependency-install cleanup escalates only its detached process group with a bounded command",
  {
    skip: process.platform !== "linux" || process.getuid() === 0,
  },
  async () => {
    const installer = createInstaller([
      'process.on("SIGTERM", () => {}); console.log("READY"); setInterval(() => {}, 1000)',
    ]);
    const cancellation = new AbortController();
    const spawnImpl = installer.options.spawnImpl;
    installer.options.spawnImpl = (command, arguments_, options) => {
      const child = spawnImpl(command, arguments_, options);
      child.stdout.on("data", () => cancellation.abort());
      return child;
    };
    const cleanupCalls = [];
    /** @type {import("../worker/install-browsers.mjs").CleanupSpawn} */
    const cleanupSpawn = (command, arguments_, options) => {
      cleanupCalls.push({ command, arguments_, options });
      process.kill(Number(arguments_.at(-1)), "SIGKILL");
      return { pid: 0, output: [], stdout: "", stderr: "", status: 0, signal: null };
    };
    assert.equal(
      await installBrowsers(["--with-deps", "webkit"], {
        ...installer.options,
        cleanupSpawn,
        signal: cancellation.signal,
      }),
      130,
    );
    assert.equal(cleanupCalls.length, 1);
    assert.equal(cleanupCalls[0].command, "sudo");
    assert.deepEqual(cleanupCalls[0].arguments_, [
      "-n",
      "--",
      "/bin/kill",
      "-KILL",
      "--",
      `-${installer.processes[0].pid}`,
    ]);
    assert.equal(cleanupCalls[0].options.timeout, 2000);
    assert.equal(cleanupCalls[0].options.killSignal, "SIGKILL");
    assert.equal(cleanupCalls[0].options.shell, undefined);
  },
);

test(
  "Ubuntu cleanup stops a root-owned descendant that ignores termination",
  {
    skip:
      process.platform !== "linux" || process.getuid() === 0 || (!process.env.CI && !CAN_ELEVATE),
  },
  async () => {
    assert.ok(CAN_ELEVATE, "Ubuntu CI must exercise privileged installer cleanup");
    const folder = mkdtempSync(join(tmpdir(), "browser-install-root-"));
    const marker = join(folder, "heartbeat");
    const rootScript = `process.on('SIGTERM', () => {}); const write = () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(Date.now())); write(); console.log('ROOT READY'); setInterval(write, 30)`;
    const installer = createInstaller([
      `process.on('SIGTERM', () => {}); require('node:child_process').spawn('sudo', ['-n', '--', process.execPath, '-e', ${JSON.stringify(rootScript)}], {stdio: 'inherit'}); setInterval(() => {}, 1000)`,
    ]);
    const cancellation = new AbortController();
    const spawnImpl = installer.options.spawnImpl;
    installer.options.spawnImpl = (command, arguments_, options) => {
      const child = spawnImpl(command, arguments_, options);
      child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("ROOT READY")) cancellation.abort();
      });
      return child;
    };
    try {
      assert.equal(
        await installBrowsers(["--with-deps", "webkit"], {
          ...installer.options,
          signal: cancellation.signal,
          timeoutMs: 5000,
        }),
        130,
      );
      const stoppedAt = readFileSync(marker, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        readFileSync(marker, "utf8"),
        stoppedAt,
        "root-owned installer processes must stop",
      );
      assert.doesNotMatch(installer.messages.join("\n"), /Could not confirm/);
    } finally {
      for (const child of installer.processes)
        spawnSync("sudo", ["-n", "--", "/bin/kill", "-KILL", "--", `-${child.pid}`], {
          timeout: 2000,
        });
      rmSync(folder, { recursive: true, force: true });
    }
  },
);

test(
  "unavailable elevated cleanup fails promptly with a clear diagnosis",
  {
    skip: process.platform !== "linux" || process.getuid() === 0,
  },
  async () => {
    const installer = createInstaller([
      'process.on("SIGTERM", () => {}); console.log("READY"); setInterval(() => {}, 1000)',
    ]);
    const cancellation = new AbortController();
    const spawnImpl = installer.options.spawnImpl;
    installer.options.spawnImpl = (command, arguments_, options) => {
      const child = spawnImpl(command, arguments_, options);
      child.stdout.on("data", () => cancellation.abort());
      return child;
    };
    assert.equal(
      await installBrowsers(["--with-deps", "webkit"], {
        ...installer.options,
        signal: cancellation.signal,
        cleanupSpawn: () => ({
          pid: 0,
          output: [],
          stdout: "",
          stderr: "",
          status: 1,
          signal: null,
        }),
      }),
      130,
    );
    assert.match(installer.messages.join("\n"), /Could not confirm privileged.*passwordless sudo/);
  },
);

test("an already-cancelled installation starts no process", async () => {
  const installer = createInstaller([]);
  const cancellation = new AbortController();
  cancellation.abort();
  assert.equal(
    await installBrowsers(["webkit"], { ...installer.options, signal: cancellation.signal }),
    130,
  );
  assert.equal(installer.invocations.length, 0);
});
