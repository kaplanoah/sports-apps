import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareRateProofNamespaces,
  verifyWithRateNamespaces,
  RateNamespaceError,
} from "../worker/codex-rate-namespaces.mjs";

const clone = "/proc/sys/kernel/unprivileged_userns_clone";
const apparmor = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

function createPolicy(values) {
  const state = new Map(Object.entries(values));
  const writes = [];
  return {
    state,
    writes,
    read(path) {
      if (!state.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return state.get(path);
    },
    write(path, value) {
      assert.ok([clone, apparmor].includes(path));
      writes.push([path, value]);
      state.set(path, value);
    },
  };
}

test("only the two official namespace settings change and exact originals are restored", () => {
  const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
  const prepared = prepareRateProofNamespaces(policy);
  assert.equal(prepared.changed, 2);
  assert.deepEqual(prepared.facts, {
    originalUsernsClone: 0,
    originalAppArmorRestriction: 1,
    namespaceSettingsChanged: 2,
  });
  assert.deepEqual(policy.writes, [
    [clone, "1\n"],
    [apparmor, "0\n"],
  ]);
  prepared.restoreNamespaces();
  assert.deepEqual(policy.writes.slice(2), [
    [apparmor, "1\n"],
    [clone, "0\n"],
  ]);
});

test("already-supported policies are read without changing host configuration", () => {
  const policy = createPolicy({ [clone]: "1", [apparmor]: "0" });
  const prepared = prepareRateProofNamespaces(policy);
  assert.equal(prepared.changed, 0);
  prepared.restoreNamespaces();
  assert.deepEqual(policy.writes, []);
});

test("absent optional kernel settings are skipped while malformed or denied reads fail before writes", () => {
  const missing = createPolicy({});
  assert.equal(prepareRateProofNamespaces(missing).present, 0);
  for (const value of ["bad", "1; unwanted", "-1", "9007199254740992"]) {
    const policy = createPolicy({ [clone]: value, [apparmor]: "1" });
    assert.throws(() => prepareRateProofNamespaces(policy));
    assert.deepEqual(policy.writes, []);
  }
  const denied = createPolicy({ [clone]: "0" });
  assert.throws(() =>
    prepareRateProofNamespaces({
      ...denied,
      read() {
        throw new Error("denied");
      },
    }),
  );
  assert.deepEqual(denied.writes, []);
});

test("partial preparation failure attempts to restore every possibly changed setting", () => {
  const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
  assert.throws(() =>
    prepareRateProofNamespaces({
      read: policy.read,
      write(path, value) {
        policy.write(path, value);
        if (path === apparmor && value === "0\n") throw new Error("write failed");
      },
    }),
  );
  assert.equal(policy.state.get(clone), "0\n");
  assert.equal(policy.state.get(apparmor), "1\n");
});

test("restoration failure is visible and does not prevent attempting the other restore", () => {
  const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
  const prepared = prepareRateProofNamespaces({
    read: policy.read,
    write(path, value) {
      policy.write(path, value);
      if (path === apparmor && value === "1\n") throw new Error("restore failed");
    },
  });
  assert.throws(() => prepared.restoreNamespaces(), /restore/);
  assert.equal(policy.state.get(clone), "0\n");
  assert.equal(policy.writes.length, 4);
});

test("the entire failed probe restores policy while preserving the failure", async () => {
  const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
  const failure = new Error("probe failed");
  await assert.rejects(
    verifyWithRateNamespaces(async () => {
      throw failure;
    }, policy),
    (error) => error === failure,
  );
  assert.equal(policy.state.get(clone), "0\n");
  assert.equal(policy.state.get(apparmor), "1\n");
});

test("restoration failure cannot return a successful proof", async () => {
  const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
  await assert.rejects(
    verifyWithRateNamespaces(async () => ({ example: true }), {
      read: policy.read,
      write(path, value) {
        policy.write(path, value);
        if (path === clone && value === "0\n") throw new Error("restore failed");
      },
    }),
    (error) => error instanceof RateNamespaceError && error.phase === "namespace-restoration",
  );
});

test("silently ignored preparation writes fail before the probe and restore earlier changes", async () => {
  const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
  let probed = false;
  await assert.rejects(
    verifyWithRateNamespaces(
      async () => {
        probed = true;
      },
      {
        read: policy.read,
        write(path, value) {
          if (path === apparmor && value === "0\n") return;
          policy.write(path, value);
        },
      },
    ),
    (error) => error instanceof RateNamespaceError && error.phase === "namespace-preparation",
  );
  assert.equal(probed, false);
  assert.equal(policy.state.get(clone), "0\n");
  assert.equal(policy.state.get(apparmor), "1\n");
});

test("restoration reads back both settings and rejects ignored or unreadable restores", async () => {
  for (const failure of ["ignored", "unreadable", "empty"]) {
    const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
    let restoring = false;
    await assert.rejects(
      verifyWithRateNamespaces(
        async () => {
          restoring = true;
          return {};
        },
        {
          read(path) {
            if (restoring && path === clone) {
              if (failure === "unreadable") throw new Error("denied");
              if (failure === "empty") return "";
            }
            return policy.read(path);
          },
          write(path, value) {
            if (restoring && path === clone && failure === "ignored") return;
            policy.write(path, value);
          },
        },
      ),
      (error) => error instanceof RateNamespaceError && error.phase === "namespace-restoration",
    );
    assert.equal(policy.state.get(apparmor), "1\n");
  }
});

test("simultaneous probe and restoration failures retain both causes", async () => {
  const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
  const probeError = new Error("probe failed");
  await assert.rejects(
    verifyWithRateNamespaces(
      async () => {
        throw probeError;
      },
      {
        read: policy.read,
        write(path, value) {
          if (path === clone && value === "0\n") return;
          policy.write(path, value);
        },
      },
    ),
    (error) =>
      error instanceof RateNamespaceError &&
      error.phase === "namespace-restoration" &&
      error.cause instanceof AggregateError &&
      error.cause.errors[0] === probeError &&
      error.cause.errors.length === 2,
  );
});

test("a successful proof records original policy only after verified restoration", async () => {
  const policy = createPolicy({ [clone]: "0", [apparmor]: "1" });
  const result = await verifyWithRateNamespaces(async () => ({ boundary: true }), policy);
  assert.deepEqual(result, {
    boundary: true,
    namespacesRestored: true,
    namespacePolicy: {
      originalUsernsClone: 0,
      originalAppArmorRestriction: 1,
      namespaceSettingsChanged: 2,
    },
  });
  assert.equal(policy.state.get(clone), "0\n");
  assert.equal(policy.state.get(apparmor), "1\n");
});
