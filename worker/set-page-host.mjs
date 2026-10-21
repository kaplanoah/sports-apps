// Gives an app's page an address of its own on a domain in the Cloudflare account, where it
// answers without its key, behind its access code alone, beside the address with the key, which
// keeps working as it was.
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
import { createSecretsClient } from "./worker-secrets.mjs";

const HOST_SECRET = "PAGE_HOST";
const CODE_SECRET = "ACCESS_CODE";

/** @param {string | undefined} host */
function checkHost(host) {
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host))
    throw new Error("Name the page's address as a host, like mlb.example.com.");
}

/**
 * The account's zone that holds the host, the domain itself or one it's under.
 * @param {{ id: string, name: string }[]} zones
 * @param {string} host
 */
function findZone(zones, host) {
  const zone = zones.find(({ name }) => host === name || host.endsWith(`.${name}`));
  if (!zone) throw new Error(`No domain in the Cloudflare account holds ${host}.`);
  return zone;
}

/**
 * @param {object} options
 * @param {string} options.app The app whose page gets the address.
 * @param {string} [options.channel] The channel whose page gets it.
 * @param {string} [options.host]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 */
export async function setPageHost({
  app,
  channel = "production",
  host,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
}) {
  checkHost(host);
  const secrets = createSecretsClient({ app, channel, fetchImpl, env, log });
  if (!(await secrets.listSecretNames()).includes(CODE_SECRET))
    throw new Error(
      "Without the key, the access code is all that guards the page, so the Worker answers there " +
        "only once it has one. Set it first with npm run set-access-code.",
    );

  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const zones = await callCloudflare("zones", `${API}/zones?per_page=50`, { method: "GET" });
  const { name } = loadWorkerConfig(app, channel);
  await callCloudflare("domain", `${findWorkersApi(readAccount(env))}/domains`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostname: host,
      service: name,
      zone_id: findZone(zones, host).id,
      environment: "production",
    }),
  });
  await secrets.putSecret(HOST_SECRET, host);
  const url = `https://${host}/`;
  log(`Page address: ${url}`);
  return url;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => {
      const { positionals, channel } = readCommandLine(process.argv.slice(2));
      const [named, host] = positionals;
      return setPageHost({ app: checkAppName(named), channel, host });
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
