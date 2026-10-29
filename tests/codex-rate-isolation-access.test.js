import test from "node:test";
import assert from "node:assert/strict";
import {
  readRatePrivilegeFacts,
  verifyRootServiceSocketDenial,
} from "../worker/codex-rate-isolation-access.mjs";

const status =
  "NoNewPrivs:\t1\nGroups:\t\nCapInh:\t00000000\nCapPrm:\t00000000\nCapEff:\t00000000\nCapBnd:\t00000000\nCapAmb:\t00000000\n";

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
