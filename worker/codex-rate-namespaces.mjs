import { readFileSync, writeFileSync } from "node:fs";

const settings = [
  { path: "/proc/sys/kernel/unprivileged_userns_clone", target: 1 },
  { path: "/proc/sys/kernel/apparmor_restrict_unprivileged_userns", target: 0 },
];

function readNamespaceValue(path, read) {
  let value;
  try {
    value = read(path).trim();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error("Could not read namespace policy.", { cause: error });
  }
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("Invalid namespace policy.");
  return value;
}

function verifyNamespaceValue(path, expected, read) {
  const value = read(path).trim();
  if (!/^\d+$/.test(value) || Number(value) !== expected)
    throw new Error("Namespace policy did not match the requested value.");
}

function restoreNamespaceValues(changed, read, write) {
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
      verifyNamespaceValue(setting.path, Number(setting.value), read);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("Could not restore namespace policy.");
}

/** @param {any} [options] */
export function snapshotRateNamespaces({ read = (path) => readFileSync(path, "utf8") } = {}) {
  return settings.map(({ path }) => readNamespaceValue(path, read));
}

/** @param {any} original @param {any} [options] */
export function restoreRateNamespaces(
  original,
  { read = (path) => readFileSync(path, "utf8"), write = writeFileSync } = {},
) {
  if (
    !Array.isArray(original) ||
    original.length !== settings.length ||
    original.some(
      (value) =>
        value !== null &&
        (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))),
    )
  )
    throw new RateNamespaceError("namespace-restoration");
  const changed = [];
  let failed = false;
  for (let index = 0; index < settings.length; index++) {
    try {
      const current = readNamespaceValue(settings[index].path, read);
      if (current === original[index]) continue;
      if (current === null || original[index] === null)
        throw new Error("Namespace availability changed.");
      changed.push({ ...settings[index], value: original[index] });
    } catch {
      failed = true;
    }
  }
  try {
    restoreNamespaceValues(changed, read, write);
  } catch {
    failed = true;
  }
  if (failed) throw new RateNamespaceError("namespace-restoration");
}

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
  const original = settings.map((setting) => ({
    ...setting,
    value: readNamespaceValue(setting.path, read),
  }));
  const changed = [];
  function restoreNamespaces() {
    restoreNamespaceValues(changed, read, write);
  }
  try {
    for (const setting of original) {
      if (setting.value === null || Number(setting.value) === setting.target) continue;
      changed.push(setting);
      write(setting.path, String(setting.target) + "\n");
      verifyNamespaceValue(setting.path, setting.target, read);
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
