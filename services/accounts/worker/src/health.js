// The secrets the service can't work without, named in its health by name alone, since its health
// reaches every app's public health answer.
const REQUIRED_SECRETS = ["EMAIL_KEY", "RP_ID"];

/**
 * @param {{ env: Record<string, unknown>, isStoreAnswering: () => Promise<boolean> }} options
 * @returns {Promise<{ ok: boolean, release: string | null, problem?: string }>}
 */
export async function readServiceHealth({ env, isStoreAnswering }) {
  // @ts-ignore the VERSION binding is Cloudflare's version metadata
  const release = env.VERSION?.tag ?? null;
  const missing = REQUIRED_SECRETS.filter((name) => !env[name]);
  if (missing.length) return { ok: false, release, problem: `no ${missing.join(" or ")} secret` };
  const ok = await isStoreAnswering().catch(() => false);
  return ok ? { ok, release } : { ok, release, problem: "its store doesn't answer" };
}
