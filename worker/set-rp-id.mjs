// Names, in the accounts service's RP_ID secret, the site every app's passkeys belong to: a domain
// each app's page host is under. It's never printed, so it stays out of the repo and the logs.
import { fileURLToPath } from "node:url";
import { readCommandLine } from "./channels.mjs";
import { createSecretsClient } from "./worker-secrets.mjs";

const SECRET_NAME = "RP_ID";
const SERVICE = "accounts";

/** @param {string | undefined} relyingPartyId */
function checkRelyingPartyId(relyingPartyId) {
  if (!relyingPartyId || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(relyingPartyId))
    throw new Error("Name the site as a domain, like example.com.");
}

/**
 * @param {object} options
 * @param {string | undefined} options.relyingPartyId
 * @param {string} [options.channel] The channel whose accounts Worker gets the site.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 */
export async function setRelyingPartyId({
  relyingPartyId,
  channel = "production",
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
}) {
  checkRelyingPartyId(relyingPartyId);
  const secrets = createSecretsClient({ app: SERVICE, channel, fetchImpl, env, log });
  if ((await secrets.listSecretNames()).includes(SECRET_NAME))
    throw new Error(
      `The ${SERVICE} Worker already has an ${SECRET_NAME}. Another would leave every passkey ` +
        "unable to sign in, so it stays.",
    );
  await secrets.putSecret(SECRET_NAME, relyingPartyId);
  log(`Set ${SECRET_NAME} on the ${SERVICE} Worker.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { positionals, channel } = readCommandLine(process.argv.slice(2));
  Promise.resolve()
    .then(() => setRelyingPartyId({ relyingPartyId: positionals[0], channel }))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
