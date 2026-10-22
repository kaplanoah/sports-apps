// Points a host one level under a domain in the Cloudflare account at an app's beta Worker for its
// previews alone, so each pull request's preview answers at its own name under the host. Beta's own
// page doesn't answer there.
import { fileURLToPath } from "node:url";
import { checkAppName } from "./apps.mjs";
import { readCommandLine } from "./channels.mjs";
import {
  API,
  createCloudflareCaller,
  findWorkersApi,
  readAccount,
  loadWorkerConfig,
} from "./deploy.mjs";
import { findZone } from "./set-page-host.mjs";
import { isHostName } from "./worker-secrets.mjs";

/**
 * Cloudflare makes a wildcard certificate under a preview host, covering each preview's name, but
 * only for a host one level under its domain; a deeper one needs Advanced Certificate Manager.
 * @param {string} host
 * @param {{ name: string }} zone
 */
export const isOneLevelUnder = (host, zone) =>
  host.endsWith(`.${zone.name}`) && !host.slice(0, -zone.name.length - 1).includes(".");

/**
 * @param {object} options
 * @param {string} options.app The app whose previews answer at the host.
 * @param {string} [options.host]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 */
export async function setPreviewHost({
  app,
  host,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
}) {
  if (!isHostName(host)) throw new Error("Name the previews' host, like mlb-previews.example.com.");
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const zones = await callCloudflare("zones", `${API}/zones?per_page=50`, { method: "GET" });
  const zone = findZone(zones, host);
  if (!isOneLevelUnder(host, zone))
    throw new Error("Name a host one level under its domain, so its previews get a certificate.");
  await callCloudflare("preview domain", `${findWorkersApi(readAccount(env))}/domains`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostname: host,
      service: loadWorkerConfig(app, "beta").name,
      zone_id: zone.id,
      environment: "production",
      enabled: false,
      previews_enabled: true,
    }),
  });
  log(`${app}'s previews answer under the host. Name it in the preview environment's secrets.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => {
      const [named, host] = readCommandLine(process.argv.slice(2)).positionals;
      return setPreviewHost({ app: checkAppName(named), host });
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
