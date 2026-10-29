import { spawnSync } from "node:child_process";
import { readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { writeRateProbeResult } from "./codex-rate-probe-output.mjs";
import {
  readRatePrivilegeFacts,
  verifyRootServiceSocketDenial,
  isPermissionDenial,
  isSandboxNetworkDenial,
  isPtraceDenial,
  isSudoDenial,
  readSocketConnection,
} from "./codex-rate-isolation-access.mjs";

function isDenied(operation) {
  try {
    operation();
    return false;
  } catch (error) {
    return isPermissionDenial(error);
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
    "import ctypes,json,sys",
    "libc=ctypes.CDLL(None,use_errno=True)",
    "result=libc.ptrace(16,int(sys.argv[1]),None,None)",
    "error_number=ctypes.get_errno()",
    "if result==0: libc.ptrace(17,int(sys.argv[1]),None,None)",
    "print(json.dumps({'result':result,'errno':error_number}))",
  ].join("\n");
  return isPtraceDenial(readPrivilegeCommand("/usr/bin/python3", ["-I", "-c", code, String(pid)]));
}

function readPrivilegeCommand(program, args) {
  return spawnSync(program, args, {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function readProcessBoundary(settings) {
  return {
    ...(await readPrivilegeFacts()),
    rootEnvironmentDenied: isDenied(() => readFileSync(`/proc/${settings.pid}/environ`)),
    rootDescriptorsDenied: isDenied(() => readlinkSync(`/proc/${settings.pid}/fd/0`)),
    rootFileDenied: isDenied(() => readFileSync(settings.privateFile)),
    controlsWriteDenied: isDenied(() => writeFileSync(settings.controls, "unwanted change")),
    rootSignalDenied: isDenied(() => process.kill(settings.pid, 0)),
    ptraceDenied: isPtraceDenied(settings.pid),
    sudoDenied: isSudoDenial(readPrivilegeCommand("/usr/bin/sudo", ["-n", "/usr/bin/true"])),
  };
}

function readConnection(port) {
  return readSocketConnection({ host: "127.0.0.1", port }, 2000);
}

async function readSandboxBoundary(settings) {
  return {
    ...(await readPrivilegeFacts()),
    gatewayNetworkDenied: isSandboxNetworkDenial(await readConnection(settings.gateway)),
    upstreamNetworkDenied: isSandboxNetworkDenial(await readConnection(settings.upstream)),
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
