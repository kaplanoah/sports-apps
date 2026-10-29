import net from "node:net";

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

/** @returns {Promise<string>} */
function readSocketAccess(path) {
  return new Promise((resolve) => {
    const socket = net.connect({ path });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish("connected"));
    socket.once("error", (error) => finish("code" in error ? String(error.code) : "unknown"));
    socket.setTimeout(500, () => finish("timeout"));
  });
}

/** @param {(path:string)=>Promise<string>|string} [connect] */
export async function verifyRootServiceSocketDenial(connect = readSocketAccess) {
  try {
    const results = await Promise.all(rootServiceSockets.map((path) => connect(path)));
    return results.every((result) => ["ENOENT", "EACCES", "EPERM"].includes(result));
  } catch {
    return false;
  }
}
