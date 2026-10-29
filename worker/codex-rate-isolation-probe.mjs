import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { writeRateProbeResult } from "./codex-rate-probe-output.mjs";
import {
  readRatePrivilegeFacts,
  verifyRootServiceSocketDenial,
} from "./codex-rate-isolation-access.mjs";

function isDenied(operation) {
  try {
    operation();
    return false;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      ["EACCES", "EPERM", "EROFS"].includes(String(error.code))
    );
  }
}

async function readPrivilegeFacts() {
  const status = readFileSync("/proc/self/status", "utf8");
  return {
    ...readRatePrivilegeFacts(status, process.getuid()),
    rootServiceSocketsDenied: await verifyRootServiceSocketDenial(),
  };
}

function isPtraceDenied(pid) {
  const code = [
    "import ctypes,errno,sys",
    "libc=ctypes.CDLL(None,use_errno=True)",
    "result=libc.ptrace(16,int(sys.argv[1]),None,None)",
    "denied=result==-1 and ctypes.get_errno() in (errno.EPERM,errno.EACCES)",
    "if result==0: libc.ptrace(17,int(sys.argv[1]),None,None)",
    "print('denied' if denied else 'allowed')",
  ].join("\n");
  return (
    execFileSync("/usr/bin/python3", ["-I", "-c", code, String(pid)], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim() === "denied"
  );
}

async function readProcessBoundary(settings) {
  let sudoDenied = false;
  try {
    execFileSync("/usr/bin/sudo", ["-n", "/usr/bin/true"], {
      timeout: 5000,
      stdio: "ignore",
    });
  } catch {
    sudoDenied = true;
  }
  return {
    ...(await readPrivilegeFacts()),
    rootEnvironmentDenied: isDenied(() => readFileSync(`/proc/${settings.pid}/environ`)),
    rootDescriptorsDenied: isDenied(() => readlinkSync(`/proc/${settings.pid}/fd/0`)),
    rootFileDenied: isDenied(() => readFileSync(settings.privateFile)),
    controlsWriteDenied: isDenied(() => writeFileSync(settings.controls, "unwanted change")),
    rootSignalDenied: isDenied(() => process.kill(settings.pid, 0)),
    ptraceDenied: isPtraceDenied(settings.pid),
    sudoDenied,
  };
}

function readConnection(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish("connected"));
    socket.once("error", (error) => finish("code" in error ? String(error.code) : "unknown"));
    socket.setTimeout(2000, () => finish("timeout"));
  });
}

async function readSandboxBoundary(settings) {
  const denied = new Set(["EPERM", "EACCES", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"]);
  return {
    ...(await readPrivilegeFacts()),
    gatewayNetworkDenied: denied.has(await readConnection(settings.gateway)),
    upstreamNetworkDenied: denied.has(await readConnection(settings.upstream)),
    checkoutWriteDenied: isDenied(() => writeFileSync(settings.projectFile, "unwanted change")),
  };
}

async function readBaseline(settings) {
  writeFileSync(settings.projectFile, "baseline");
  return {
    gatewayReachable: (await readConnection(settings.gateway)) === "connected",
    upstreamReachable: (await readConnection(settings.upstream)) === "connected",
    checkoutWritable: readFileSync(settings.projectFile, "utf8") === "baseline",
  };
}

try {
  const settings = JSON.parse(process.argv[3]);
  let facts;
  if (process.argv[2] === "process") facts = await readProcessBoundary(settings);
  else if (process.argv[2] === "sandbox") facts = await readSandboxBoundary(settings);
  else if (process.argv[2] === "baseline") facts = await readBaseline(settings);
  else throw new Error("Unsupported probe.");
  writeRateProbeResult(facts);
} catch {
  process.stderr.write("Isolation probe could not establish its facts.\n");
  process.exitCode = 1;
}
