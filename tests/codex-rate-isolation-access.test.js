import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  readRatePrivilegeFacts,
  verifyRootServiceSocketDenial,
  isPermissionDenial,
  isSandboxNetworkDenial,
  isPtraceDenial,
  isSudoDenial,
  readSocketConnection,
} from "../worker/codex-rate-isolation-access.mjs";

const status =
  "NoNewPrivs:\t1\nGroups:\t\nCapInh:\t00000000\nCapPrm:\t00000000\nCapEff:\t00000000\nCapBnd:\t00000000\nCapAmb:\t00000000\n";

test("permission and network denial classifiers reject missing resources and timeouts", () => {
  for (const code of ["EACCES", "EPERM", "EROFS"])
    assert.equal(isPermissionDenial(Object.assign(new Error("denied"), { code })), true);
  for (const code of ["ENOENT", "ETIMEDOUT", "EIO"])
    assert.equal(isPermissionDenial(Object.assign(new Error("failed"), { code })), false);
  assert.equal(isPermissionDenial({ code: "EPERM" }), false);
  for (const code of ["EPERM", "EACCES", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"])
    assert.equal(isSandboxNetworkDenial(code), true);
  for (const code of ["connected", "ENOENT", "timeout", "unknown", "ECONNRESET"])
    assert.equal(isSandboxNetworkDenial(code), false);
});

test("ptrace and sudo require actual recognized command results rather than arbitrary execution failures", () => {
  for (const errno of [1, 13])
    assert.equal(
      isPtraceDenial({ status: 0, stdout: JSON.stringify({ result: -1, errno }) }),
      true,
    );
  for (const result of [
    { status: 0, stdout: JSON.stringify({ result: 0, errno: 1 }) },
    { status: 0, stdout: JSON.stringify({ result: -1, errno: 3 }) },
    { status: 1, stdout: JSON.stringify({ result: -1, errno: 1 }) },
    { status: 0, stdout: "denied" },
    { status: 0, stdout: JSON.stringify({ result: -1, errno: 1 }), error: { code: "ENOENT" } },
    { status: 0, stdout: JSON.stringify({ result: -1, errno: 1 }), signal: "SIGTERM" },
  ])
    assert.equal(isPtraceDenial(result), false);
  for (const stderr of [
    "The no new privileges flag is set",
    "a password is required",
    "must be setuid root",
    "effective uid is not 0",
    "not allowed to execute",
    "not in the sudoers file",
  ])
    assert.equal(isSudoDenial({ status: 1, stderr }), true);
  for (const result of [
    { status: 0, stderr: "no new privileges" },
    { status: 1, stderr: "unknown failure" },
    { status: 127, stderr: "no new privileges" },
    { status: 1, stderr: "no new privileges", error: { code: "ETIMEDOUT" } },
    { status: 1, stderr: "no new privileges", signal: "SIGTERM" },
  ])
    assert.equal(isSudoDenial(result), false);
});

test("the shared socket reader uses exact options, closes sockets and preserves only connection outcome codes", async () => {
  for (const outcome of ["connected", "EACCES", "unknown", "timeout"]) {
    const socket = new EventEmitter();
    let destroyed = false;
    let timeout;
    Object.assign(socket, {
      destroy() {
        destroyed = true;
      },
      setTimeout(ms, callback) {
        assert.equal(ms, 500);
        timeout = callback;
      },
    });
    const pending = readSocketConnection({ path: "/example.sock" }, 500, (options) => {
      assert.deepEqual(options, { path: "/example.sock" });
      return socket;
    });
    if (outcome === "connected") socket.emit("connect");
    else if (outcome === "timeout") timeout();
    else
      socket.emit(
        "error",
        outcome === "unknown"
          ? new Error("failed")
          : Object.assign(new Error("denied"), { code: outcome }),
      );
    assert.equal(await pending, outcome);
    assert.equal(destroyed, true);
  }
});

test("privilege facts require actual empty supplementary groups and every zero capability set", () => {
  assert.deepEqual(readRatePrivilegeFacts(status, 1000), {
    unprivileged: true,
    noNewPrivileges: true,
    noCapabilities: true,
    supplementaryGroupsCleared: true,
  });
  assert.equal(
    readRatePrivilegeFacts(status.replace("Groups:\t", "Groups:\t27 121"), 1000)
      .supplementaryGroupsCleared,
    false,
  );
  assert.equal(
    readRatePrivilegeFacts(status.replace("Groups:\t\n", ""), 1000).supplementaryGroupsCleared,
    false,
  );
  assert.equal(readRatePrivilegeFacts(status, 0).unprivileged, false);
  assert.equal(
    readRatePrivilegeFacts(status.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0"), 1000)
      .noNewPrivileges,
    false,
  );
  for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) {
    assert.equal(
      readRatePrivilegeFacts(status.replace(`${name}:\t00000000`, `${name}:\t00000001`), 1000)
        .noCapabilities,
      false,
    );
  }
});

test("each known root-service socket must be absent or deny an actual connection", async () => {
  const paths = [];
  assert.equal(
    await verifyRootServiceSocketDenial((path) => {
      paths.push(path);
      return "ENOENT";
    }),
    true,
  );
  assert.ok(paths.includes("/var/run/docker.sock"));
  assert.ok(paths.includes("/run/containerd/containerd.sock"));
  for (const accessible of paths) {
    assert.equal(
      await verifyRootServiceSocketDenial((path) => (path === accessible ? "connected" : "EACCES")),
      false,
    );
  }
});

test("refused, timed-out and unknown sockets do not become permission-denial proof", async () => {
  for (const result of ["EACCES", "EPERM"]) {
    assert.equal(await verifyRootServiceSocketDenial(() => result), true);
  }
  for (const result of ["ECONNREFUSED", "ECONNRESET", "timeout", "unknown"]) {
    assert.equal(await verifyRootServiceSocketDenial(() => result), false);
  }
  assert.equal(
    await verifyRootServiceSocketDenial(() => {
      throw new Error("unknown");
    }),
    false,
  );
});
