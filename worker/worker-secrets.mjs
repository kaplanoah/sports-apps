// Reads and changes the secrets of an app's Worker on a channel through Cloudflare's API. Each change deploys the
// Worker's live version again with the new secret.
import {
  createCloudflareCaller,
  findWorkersApi,
  formatWorkerUrl,
  readAccount,
  readAppWorkerConfig,
} from "./deploy.mjs";

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
  const { name } = readAppWorkerConfig(app, channel);
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const secretsUrl = `${base}/scripts/${name}/secrets`;

  return {
    /** @returns {Promise<string[]>} */
    listSecretNames: async () =>
      (await callCloudflare("secrets", secretsUrl, { method: "GET" })).map((secret) => secret.name),
    /**
     * @param {string} secretName
     * @param {string} text
     */
    putSecret: (secretName, text) =>
      callCloudflare(secretName, secretsUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: secretName, text, type: "secret_text" }),
      }),
    /** @param {string} secretName */
    deleteSecret: (secretName) =>
      callCloudflare(secretName, `${secretsUrl}/${secretName}`, { method: "DELETE" }),
    readWorkerUrl: async () => {
      const { subdomain } = await callCloudflare("subdomain", `${base}/subdomain`, {
        method: "GET",
      });
      return formatWorkerUrl(name, subdomain);
    },
  };
}
