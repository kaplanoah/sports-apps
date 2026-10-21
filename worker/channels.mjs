// Each app and service has a Worker per channel. Production deploys from main. Beta deploys from
// the beta branch, so a change can be used on a phone before it merges, with its own store, and
// for an app its own key and address, from the environment of the same name in its wrangler.toml.
import { parseArgs } from "node:util";

/**
 * @typedef {object} Channel
 * @property {string} branch
 * @property {string | null} environment
 * @property {string | null} label
 * @property {string} howToShip
 * @property {boolean} isForcePushed whether each push replaces what the branch held
 */

/** @type {Record<string, Channel>} */
const CHANNELS = {
  production: {
    branch: "main",
    environment: null,
    label: null,
    howToShip: "Merge through a pull request",
    isForcePushed: false,
  },
  beta: {
    branch: "beta",
    environment: "beta",
    label: "beta",
    // Beta holds one pull request at a time, so a change gets there only by the steps that claim it.
    howToShip:
      'Put it on beta by the ship skill\'s "The beta channel" (.claude/skills/ship/SKILL.md), which claims beta first',
    isForcePushed: true,
  },
};

/**
 * @param {string} [name]
 * @returns {Channel}
 */
export function findChannel(name = "production") {
  if (Object.hasOwn(CHANNELS, name)) return CHANNELS[name];
  throw new Error(
    `There's no channel named ${name}. The channels are: ${Object.keys(CHANNELS).join(", ")}.`,
  );
}

/**
 * A command's arguments: its app and anything else it names, its own switches, and the channel
 * `--channel` names, production when it names none.
 * @param {string[]} args
 * @param {Record<string, { type: "boolean" }>} [switches]
 * @returns {{ positionals: string[], flags: Record<string, boolean | undefined>, channel: string }}
 */
export function readCommandLine(args, switches = {}) {
  const { values, positionals } = parseArgs({
    args,
    options: { ...switches, channel: { type: "string" } },
    allowPositionals: true,
  });
  const { channel = "production", ...flags } = values;
  findChannel(String(channel));
  return {
    positionals,
    flags: /** @type {Record<string, boolean | undefined>} */ (flags),
    channel: String(channel),
  };
}
