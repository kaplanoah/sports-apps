import { listMissingSecrets } from "./secrets.js";

// A missing secret is named by name alone, since the service's health reaches every app's public
// health answer.
/**
 * @param {{ env: Record<string, unknown>, isStoreAnswering: () => Promise<boolean> }} options
 * @returns {Promise<{ ok: boolean, release: string | null, problem?: string }>}
 */
export async function readServiceHealth({ env, isStoreAnswering }) {
  // @ts-ignore the VERSION binding is Cloudflare's version metadata
  const release = env.VERSION?.tag ?? null;
  const missing = listMissingSecrets(env).map(({ name }) => name);
  if (missing.length) return { ok: false, release, problem: `no ${missing.join(" or ")} secret` };
  const ok = await isStoreAnswering().catch(() => false);
  return ok ? { ok, release } : { ok, release, problem: "its store doesn't answer" };
}
