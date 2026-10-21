// Reads and changes the secrets of an app's or a service's Worker on a channel through Cloudflare's API, and checks
// a host named for one. Each change deploys the Worker's live version again with the new secret.
import {
  createCloudflareCaller,
  findWorkersApi,
  formatWorkerUrl,
  readAccount,
  loadWorkerConfig,
  readWorkersSubdomain,
} from "./deploy.mjs";

/**
 * Whether text names a host, like example.com, in lowercase and with no scheme or path.
 * @param {string | undefined} text
 */
export const isHostName = (text) => Boolean(text) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text);

/**
 * @param {object} options
 * @param {string} options.app
 * @param {string} [options.channel]
 * @param {typeof fetch} options.fetchImpl
 * @param {NodeJS.ProcessEnv} options.env
 * @param {typeof console.log} options.log
 */
export function createSecretsClient({ app, channel, fetchImpl, env, log }) {
  const base = findWorkersApi(readAccount(env));
  const { name } = loadWorkerConfig(app, channel);
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const secretsUrl = `${base}/scripts/${name}/secrets`;

  /** @returns {Promise<string[]>} */
  const listSecretNames = async () =>
    (await callCloudflare("secrets", secretsUrl, { method: "GET" })).map((secret) => secret.name);

  /**
   * @param {string} secretName
   * @param {string} text
   */
  const putSecret = (secretName, text) =>
    callCloudflare(secretName, secretsUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: secretName, text, type: "secret_text" }),
    });

  /**
   * Puts a secret that, once set, stays, refusing when the Worker already has it.
   * @param {string} secretName
   * @param {string} text
   * @param {string} whyItStays
   */
  async function putLastingSecret(secretName, text, whyItStays) {
    if ((await listSecretNames()).includes(secretName))
      throw new Error(`The ${app} Worker already has an ${secretName}. ${whyItStays}`);
    await putSecret(secretName, text);
    log(`Set ${secretName} on the ${app} Worker.`);
  }

  return {
    listSecretNames,
    putSecret,
    putLastingSecret,
    /** @param {string} secretName */
    deleteSecret: (secretName) =>
      callCloudflare(secretName, `${secretsUrl}/${secretName}`, { method: "DELETE" }),
    readWorkerUrl: () => formatWorkerUrl(name, readWorkersSubdomain(env)),
  };
}
