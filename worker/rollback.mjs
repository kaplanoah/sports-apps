// Puts an app's previous version back at all of its traffic, with the call a deploy makes when its
// new version doesn't answer. The previous version is the newest deployment before the live code
// whose version records another commit, since a secret change deploys the same code again, and
// a rollback keeps the secrets as they are. On main, a version a rollback already took down is
// passed over: one deployed between two deployments of the live commit, and one whose commit the
// live one doesn't build on.
import { fileURLToPath } from "node:url";
import { checkAppName } from "./apps.mjs";
import { findChannel, readCommandLine } from "./channels.mjs";
import {
  createCloudflareCaller,
  createDeploymentsClient,
  findMainVersion,
  findWorkersApi,
  isAncestor,
  readAccount,
  readAppWorkerConfig,
  runGit,
} from "./deploy.mjs";

/** @typedef {{ version_id: string, percentage: number }[]} Deployment */
/** @typedef {{ deployment: Deployment, commit: string }} RecordedDeployment */

/**
 * Each deployment whose version records its commit, newest first, with that commit.
 * @param {Deployment[]} deployments newest first
 * @param {(deployment: Deployment, what: string) => Promise<string | null>} readCommit
 * @returns {Promise<RecordedDeployment[]>}
 */
async function listRecordedDeployments(deployments, readCommit) {
  const recorded = [];
  for (const deployment of deployments) {
    const commit = await readCommit(deployment, "recorded commit");
    if (commit) recorded.push({ deployment, commit });
  }
  return recorded;
}

/**
 * The deployment to go back to. On main, a deployment of the live commit after another one is a
 * rollback, so it's the newest older than every deployment of the live commit, whose commit the
 * live one builds on. A force-pushed branch deploys any commit again as it's pushed again, so
 * there it's the newest whose commit isn't the live one.
 * @param {RecordedDeployment[]} recorded newest first, the live one first of all
 * @param {{ isForcePushed: boolean, isBuiltOn: (commit: string) => boolean }} channel
 */
function findEarlier(recorded, { isForcePushed, isBuiltOn }) {
  const live = recorded[0].commit;
  if (isForcePushed) return recorded.find(({ commit }) => commit !== live) ?? null;
  const oldestLive = recorded.findLastIndex(({ commit }) => commit === live);
  return recorded.slice(oldestLive + 1).find(({ commit }) => isBuiltOn(commit)) ?? null;
}

/**
 * @param {object} options
 * @param {string} options.app
 * @param {string} [options.channel]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 * @param {import("./deploy.mjs").Git} [options.git]
 * @returns {Promise<{ from: string, to: string }>} the commit that was live, and the one now
 */
export async function rollBack({
  app,
  channel = "production",
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
  git = runGit,
}) {
  const { name } = readAppWorkerConfig(app, channel);
  const { branch, isForcePushed } = findChannel(channel);
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const client = createDeploymentsClient({
    base: findWorkersApi(readAccount(env)),
    name,
    callCloudflare,
  });
  const recorded = await listRecordedDeployments(await client.listDeployments(), client.readCommit);
  const [live] = recorded;
  if (!live)
    throw new Error(`No version of ${name} records its commit, so there's none to go back to.`);
  if (!isForcePushed) git(["fetch", "--quiet", "origin", branch]);
  const earlier = findEarlier(recorded, {
    isForcePushed,
    isBuiltOn: (commit) => isAncestor(git, commit, live.commit),
  });
  if (!earlier)
    throw new Error(
      `${name} has no earlier version than ${live.commit.slice(0, 7)} to go back to.`,
    );
  const { version_id } = findMainVersion(earlier.deployment);
  await client.putLive([{ version_id, percentage: 100 }]);
  log(
    `${name} was live at ${live.commit.slice(0, 7)} and is now at ${earlier.commit.slice(0, 7)}.`,
  );
  return { from: live.commit, to: earlier.commit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => {
      const { positionals, channel } = readCommandLine(process.argv.slice(2));
      return rollBack({ app: checkAppName(positionals[0]), channel });
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
