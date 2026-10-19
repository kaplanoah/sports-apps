// Gives the Worker the APP_KEY secret that the page and its store answer under.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkAppName } from "./apps.mjs";
import { readCommandLine } from "./channels.mjs";
import { createSecretsClient } from "./worker-secrets.mjs";

const SECRET_NAME = "APP_KEY";

export const createKey = () => randomBytes(24).toString("base64url");

/**
 * @param {object} options
 * @param {string} options.app The app whose Worker gets the key.
 * @param {string} [options.channel] The channel whose Worker gets the key.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 * @param {boolean} [options.isRotating]
 * @param {() => string} [options.makeKey]
 */
export async function setAppKey({
  app,
  channel = "production",
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
  isRotating = false,
  makeKey = createKey,
}) {
  const secrets = createSecretsClient({ app, channel, fetchImpl, env, log });
  // A key stored without its address printed would be lost, so a missing subdomain stops first.
  const workerUrl = secrets.readWorkerUrl();
  if ((await secrets.listSecretNames()).includes(SECRET_NAME) && !isRotating)
    throw new Error(
      `The Worker already has an ${SECRET_NAME}. A new one changes the page's address, so the ` +
        "home-screen icon stops working. To do it anyway, add --rotate.",
    );

  const key = makeKey();
  await secrets.putSecret(SECRET_NAME, key);
  const url = `${workerUrl}${key}/`;
  log(`Page address: ${url}`);
  return url;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => {
      const { positionals, flags, channel } = readCommandLine(process.argv.slice(2), {
        rotate: { type: "boolean" },
      });
      return setAppKey({ app: checkAppName(positionals[0]), channel, isRotating: !!flags.rotate });
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
