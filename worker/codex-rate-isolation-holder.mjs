import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  prepareProtectedNativeRuntime,
  startNativeRateRuntime,
  superviseNativeAdmission,
  inspectProcessLifetime,
  validateNativeQuotaResult,
} from "./codex-rate-runtime.mjs";
import { readNativeRatePolicyHash } from "./codex-rate-policy.mjs";

const settings = JSON.parse(process.argv[2]);
const responseText =
  'data: {"type":"response.output_text.delta","delta":"example"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":2}}}\n\n';
const upstream = http.createServer((request, response) => {
  const correct = request.headers.authorization === "Bearer isolation-test-only";
  request.resume();
  response.writeHead(correct ? 200 : 403, { "content-type": "text/event-stream" });
  response.write(responseText.slice(0, 9));
  setImmediate(() => response.end(responseText.slice(9)));
});
let folder;
let parent;
let supervision;
let closed = false;
async function closeHolder() {
  if (closed) return;
  closed = true;
  try {
    if (parent && parent.exitCode === null) {
      const exited = once(parent, "exit");
      parent.kill("SIGTERM");
      await exited;
    }
    await supervision;
    if (folder) {
      const result = JSON.parse(readFileSync(join(folder, "public/cooldown.json"), "utf8"));
      validateNativeQuotaResult(result, {
        repository: "example/repository",
        run: 1,
        source: "a".repeat(40),
      });
      if (existsSync(join(folder, "private"))) throw new Error("Private runtime was not removed.");
    }
  } finally {
    if (folder) rmSync(folder, { recursive: true, force: true });
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    process.disconnect?.();
  }
}
try {
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  if (typeof address === "string" || !address) throw new Error("Loopback listener unavailable.");
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const gateway = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  if (!gateway || typeof gateway === "string") throw new Error("Loopback port unavailable.");
  ({ folder } = prepareProtectedNativeRuntime({
    version: 1,
    repository: "example/repository",
    run: 1,
    job: 1,
    source: "a".repeat(40),
    policy: readNativeRatePolicyHash(),
    notBefore: 0,
    scanSince: 0,
    activeRuns: [1],
    hosted: true,
    port: gateway.port,
  }));
  parent = spawn(
    "/usr/bin/setpriv",
    [
      `--reuid=${settings.uid}`,
      `--regid=${settings.gid}`,
      "--clear-groups",
      "--no-new-privs",
      "--bounding-set=-all",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "/usr/bin/sleep",
      "120",
    ],
    { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }, stdio: "ignore" },
  );
  await once(parent, "spawn");
  const lifetime = inspectProcessLifetime(parent.pid);
  if (!lifetime) throw new Error("Proof parent unavailable.");
  supervision = superviseNativeAdmission(folder, lifetime, {
    start: (admission) =>
      startNativeRateRuntime(admission, {
        send: async (_url, options) =>
          fetch(`http://127.0.0.1:${address.port}/v1/responses`, options),
      }),
  });
  let failure;
  supervision.catch((error) => {
    failure = error;
  });
  let remaining = 200;
  while (!existsSync(join(folder, "public/ready.json"))) {
    if (failure || --remaining <= 0) throw new Error("Protected runtime startup failed.");
    await delay(25);
  }
  for (const event of ["disconnect", "SIGTERM"])
    process.on(event, () => {
      void closeHolder();
    });
  process.on("message", (message) => {
    if (message === "close") void closeHolder();
  });
  process.send?.({
    gateway: gateway.port,
    upstream: address.port,
    nativeRoot: folder,
    controls: [
      "public/runtime.mjs",
      "public/hook.sh",
      "public/identity.json",
      "private/settings.json",
    ].map((name) => join(folder, name)),
  });
} catch (error) {
  await closeHolder();
  throw error;
}
