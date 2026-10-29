import net from "node:net";
import { constants } from "node:os";
import { writeFileSync } from "node:fs";

const rootServiceSockets = [
  "/var/run/docker.sock",
  "/run/docker.sock",
  "/run/containerd/containerd.sock",
  "/run/crio/crio.sock",
  "/run/podman/podman.sock",
];

export function readRatePrivilegeFacts(status, uid) {
  const capabilities = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"];
  return {
    unprivileged: uid !== 0,
    noNewPrivileges: /^NoNewPrivs:\s+1$/m.test(status),
    noCapabilities: capabilities.every((name) => new RegExp(`^${name}:\\s+0+$`, "m").test(status)),
    supplementaryGroupsCleared: /^Groups:[ \t]*$/m.test(status),
  };
}

export function isPermissionDenial(error) {
  return (
    error instanceof Error &&
    "code" in error &&
    ["EACCES", "EPERM", "EROFS"].includes(String(error.code))
  );
}

/** @param {any} paths @param {(path:string,value:string)=>void} [write] */
export function verifyControlFileDenials(paths, write = writeFileSync) {
  return (
    Array.isArray(paths) &&
    paths.length > 0 &&
    paths.every((path) => {
      if (typeof path !== "string") return false;
      try {
        write(path, "unwanted change");
        return false;
      } catch (error) {
        return isPermissionDenial(error);
      }
    })
  );
}

export function isSandboxNetworkDenial(result) {
  return ["EPERM", "EACCES", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(result);
}

export function isPtraceDenial(result) {
  if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== "string")
    return false;
  try {
    const outcome = JSON.parse(result.stdout);
    return (
      outcome?.result === -1 &&
      Object.keys(outcome).length === 2 &&
      [constants.errno.EPERM, constants.errno.EACCES].includes(outcome.errno)
    );
  } catch {
    return false;
  }
}

export function isSudoDenial(result) {
  return (
    !result.error &&
    !result.signal &&
    result.status === 1 &&
    typeof result.stderr === "string" &&
    /no new privileges|must be setuid root|effective uid is not 0|a password is required|not allowed to execute|not in the sudoers/i.test(
      result.stderr,
    )
  );
}

/** @param {any} options @param {number} timeoutMs @param {(options:any)=>any} [connect] @returns {Promise<string>} */
export function readSocketConnection(options, timeoutMs, connect = net.connect) {
  return new Promise((resolve) => {
    const socket = connect(options);
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish("connected"));
    socket.once("error", (error) => finish("code" in error ? String(error.code) : "unknown"));
    socket.setTimeout(timeoutMs, () => finish("timeout"));
  });
}

/** @param {(path:string)=>Promise<string>|string} [connect] */
export async function verifyRootServiceSocketDenial(
  connect = (path) => readSocketConnection({ path }, 500),
) {
  try {
    const results = await Promise.all(rootServiceSockets.map((path) => connect(path)));
    return results.every((result) => ["ENOENT", "EACCES", "EPERM"].includes(result));
  } catch {
    return false;
  }
}
