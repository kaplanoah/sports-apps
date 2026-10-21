// Gives the accounts service the EMAIL_KEY secret it hashes each email under, made here at random
// and never printed, so only the service ever holds it.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readCommandLine } from "./channels.mjs";
import { createSecretsClient } from "./worker-secrets.mjs";

const SECRET_NAME = "EMAIL_KEY";
const SERVICE = "accounts";

const createEmailKey = () => randomBytes(32).toString("base64url");

/**
 * @param {object} options
 * @param {string} [options.channel] The channel whose accounts Worker gets the key.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 */
export async function setEmailKey({
  channel = "production",
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
}) {
  const secrets = createSecretsClient({ app: SERVICE, channel, fetchImpl, env, log });
  // Every email kept is a hash under this key, so a new one would leave no email findable.
  if ((await secrets.listSecretNames()).includes(SECRET_NAME))
    throw new Error(
      `The ${SERVICE} Worker already has an ${SECRET_NAME}. A new one would lose every account's ` +
        "email, so it stays.",
    );
  await secrets.putSecret(SECRET_NAME, createEmailKey());
  log(`Set ${SECRET_NAME} on the ${SERVICE} Worker.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => setEmailKey({ channel: readCommandLine(process.argv.slice(2)).channel }))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
