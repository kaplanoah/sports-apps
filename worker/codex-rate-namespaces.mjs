import { readFileSync, writeFileSync } from "node:fs";

const settings = [
  { path: "/proc/sys/kernel/unprivileged_userns_clone", target: 1 },
  { path: "/proc/sys/kernel/apparmor_restrict_unprivileged_userns", target: 0 },
];

export class RateNamespaceError extends Error {
  constructor(phase, options = {}) {
    super("Could not establish the hosted namespace lifecycle.", options);
    this.phase = phase;
  }
}

/** @param {(facts:any)=>Promise<any>} verify @param {any} [options] */
export async function verifyWithRateNamespaces(verify, options) {
  let namespaces;
  try {
    namespaces = prepareRateProofNamespaces(options);
  } catch (error) {
    if (error instanceof RateNamespaceError) throw error;
    throw new RateNamespaceError("namespace-preparation", { cause: error });
  }
  let result;
  let failed = false;
  let verificationError;
  try {
    result = await verify(namespaces.facts);
  } catch (error) {
    failed = true;
    verificationError = error;
  }
  try {
    namespaces.restoreNamespaces();
  } catch (error) {
    throw new RateNamespaceError("namespace-restoration", {
      cause: new AggregateError(
        failed ? [verificationError, error] : [error],
        "Namespace restoration failed.",
      ),
    });
  }
  if (failed) throw verificationError;
  return { ...result, namespacesRestored: true, namespacePolicy: namespaces.facts };
}

/** @param {{read?:(path:string)=>string,write?:(path:string,value:string)=>void}} [options] */
export function prepareRateProofNamespaces({
  read = (path) => readFileSync(path, "utf8"),
  write = (path, value) => writeFileSync(path, value),
} = {}) {
  const original = settings.map((setting) => {
    let value;
    try {
      value = read(setting.path).trim();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { ...setting, value: null };
      throw new Error("Could not read namespace policy.", { cause: error });
    }
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new Error("Invalid namespace policy.");
    return { ...setting, value };
  });
  const changed = [];
  function verifyNamespaceValue(path, expected) {
    const value = read(path).trim();
    if (!/^\d+$/.test(value) || Number(value) !== expected)
      throw new Error("Namespace policy did not match the requested value.");
  }
  function restoreNamespaces() {
    let failed = false;
    for (const setting of [...changed].reverse()) {
      try {
        write(setting.path, setting.value + "\n");
      } catch {
        failed = true;
      }
    }
    for (const setting of changed) {
      try {
        verifyNamespaceValue(setting.path, Number(setting.value));
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error("Could not restore namespace policy.");
  }
  try {
    for (const setting of original) {
      if (setting.value === null || Number(setting.value) === setting.target) continue;
      changed.push(setting);
      write(setting.path, String(setting.target) + "\n");
      verifyNamespaceValue(setting.path, setting.target);
    }
  } catch (error) {
    try {
      restoreNamespaces();
    } catch (restoration) {
      throw new RateNamespaceError("namespace-restoration", {
        cause: new AggregateError(
          [error, restoration],
          "Namespace preparation and restoration failed.",
        ),
      });
    }
    throw new Error("Could not prepare namespace policy.", { cause: error });
  }
  return {
    facts: {
      originalUsernsClone: original[0].value === null ? null : Number(original[0].value),
      originalAppArmorRestriction: original[1].value === null ? null : Number(original[1].value),
      namespaceSettingsChanged: changed.length,
    },
    restoreNamespaces,
  };
}
