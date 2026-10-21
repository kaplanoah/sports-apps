import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ACCOUNTS_TOML = `name = "accounts"
compatibility_date = "2026-09-01"

[[durable_objects.bindings]]
name = "STORE"
class_name = "AccountStore"

[env.beta]
name = "accounts-beta"
`;

/**
 * A services folder that holds one service, accounts, beside the repo's own apps, for a test to
 * pass as its roots, and a function that removes it.
 * @returns {{ roots: import("../worker/apps.mjs").WorkerRoots, remove: () => void }}
 */
export function createServiceRoots() {
  const folder = mkdtempSync(join(tmpdir(), "services-"));
  mkdirSync(join(folder, "accounts/worker"), { recursive: true });
  writeFileSync(join(folder, "accounts/worker/wrangler.toml"), ACCOUNTS_TOML);
  return {
    roots: { servicesRoot: pathToFileURL(`${folder}/`) },
    remove: () => rmSync(folder, { recursive: true, force: true }),
  };
}
