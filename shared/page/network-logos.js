import { html } from "./html.js";

// The channels a game can be on that have a logo in networks/, each a public-domain file from
// Wikimedia Commons or one the repo's owner supplied. A channel goes by more than one name across
// the leagues' feeds, and any of them finds its logo; a channel without one shows its name instead.

/**
 * A channel's logo, for a light background, with a version for a dark one beside it, its name
 * ending in -dark, unless the one works on both.
 * @typedef {{ name: string, file: string, darkFile?: string, scale?: number, nudge?: number }} NetworkLogo
 */

/**
 * @typedef {object} Channel
 * @property {string} name
 * @property {string} file its logo's file
 * @property {string[]} names what the feeds call it, besides its name
 * @property {string[]} [searchWords] what fans call it besides those, as a search reads it
 * @property {boolean} [hasDarkVersion]
 * @property {number} [scale] its height against the line's usual logo height, so a square badge
 *   and a long wordmark look about the same size
 * @property {number} [nudge] how far up to move it, as a share of its height, when its weight sits
 *   below its middle (or down, when negative), so it lines up with the rest by eye
 */

/** @type {Channel[]} */
const CHANNELS = [
  { name: "ABC", file: "abc.png", names: [], hasDarkVersion: true, scale: 1.22, nudge: 0.02 },
  {
    name: "Apple TV",
    file: "apple-tv.svg",
    names: [],
    searchWords: ["apple tv plus", "apple"],
    hasDarkVersion: true,
    scale: 0.99,
    nudge: 0.08,
  },
  { name: "CNBC", file: "cnbc.svg", names: [], hasDarkVersion: true, scale: 1.24, nudge: 0.04 },
  { name: "ESPN", file: "espn.svg", names: [], scale: 0.81, nudge: -0.02 },
  {
    name: "ESPN2",
    file: "espn2.svg",
    names: [],
    searchWords: ["espn 2"],
    scale: 0.81,
    nudge: -0.02,
  },
  { name: "FOX", file: "fox.svg", names: [], hasDarkVersion: true, scale: 0.84, nudge: -0.04 },
  {
    name: "FOX One",
    file: "fox-one.svg",
    names: [],
    hasDarkVersion: true,
    scale: 0.84,
    nudge: -0.04,
  },
  { name: "FS1", file: "fs1.svg", names: [], searchWords: ["fox sports 1"], scale: 1.12 },
  {
    name: "HBO Max",
    file: "hbo-max.svg",
    names: [],
    searchWords: ["hbo", "max"],
    hasDarkVersion: true,
    scale: 0.72,
    nudge: -0.06,
  },
  {
    name: "MLB Network",
    file: "mlb-network.png",
    names: [],
    searchWords: ["mlbn"],
    scale: 1.3,
    nudge: -0.04,
  },
  { name: "NBC", file: "nbc.svg", names: [], hasDarkVersion: true, scale: 0.94, nudge: 0.08 },
  {
    name: "NBCSN",
    file: "nbcsn.png",
    names: [],
    hasDarkVersion: true,
    scale: 0.988,
    nudge: -0.115,
  },
  { name: "Netflix", file: "netflix.svg", names: [], scale: 0.92, nudge: -0.06 },
  {
    name: "Peacock",
    file: "peacock.svg",
    names: [],
    hasDarkVersion: true,
    scale: 1.14,
    nudge: -0.02,
  },
  {
    name: "Prime Video",
    file: "prime-video.png",
    names: [],
    searchWords: ["prime", "amazon", "amazon prime"],
    scale: 1.14,
    nudge: -0.06,
  },
  { name: "SNY", file: "sny.png", names: [], hasDarkVersion: true, scale: 0.98, nudge: 0.08 },
  { name: "TBS", file: "tbs.svg", names: [], hasDarkVersion: true, scale: 1.06 },
  { name: "USA Network", file: "usa.png", names: ["USA Net"], searchWords: ["usa"], scale: 0.94 },
];

const foldName = (name) => name.trim().toLowerCase();

/**
 * @param {Channel} channel
 * @returns {NetworkLogo}
 */
const describeLogo = ({ name, file, hasDarkVersion, scale, nudge }) => ({
  name,
  file,
  ...(hasDarkVersion && { darkFile: file.replace(/(\.\w+)$/, "-dark$1") }),
  ...(scale && { scale }),
  ...(nudge && { nudge }),
});

export const NETWORK_LOGOS = CHANNELS.map(describeLogo);

const LOGO_BY_NAME = new Map(
  CHANNELS.flatMap((channel, index) =>
    [channel.name, ...channel.names].map((name) => [foldName(name), NETWORK_LOGOS[index]]),
  ),
);

const CHANNEL_BY_NAME = new Map(
  CHANNELS.flatMap((channel) =>
    [channel.name, ...channel.names].map((name) => [foldName(name), channel]),
  ),
);

/**
 * The channel a feed lists a game on, by the name it goes by, and every word that names it: its
 * names and what fans call it, or, for a channel without a logo, the name it's listed by.
 * @param {string} listing
 * @returns {{ name: string, words: string[] }}
 */
export function describeChannel(listing) {
  const channel = CHANNEL_BY_NAME.get(foldName(listing));
  if (!channel) return { name: listing, words: [listing] };
  return {
    name: channel.name,
    words: [channel.name, ...channel.names, ...(channel.searchWords ?? [])],
  };
}

/**
 * Each channel's logo, or its name when it has none, once each: two names for one channel, like
 * ESPN and the ESPN App, show its logo once.
 * @param {string[]} networks
 * @returns {(NetworkLogo | string)[]}
 */
export const listNetworkLogos = (networks) => [
  ...new Set(networks.map((name) => LOGO_BY_NAME.get(foldName(name)) ?? name)),
];

/**
 * @param {NetworkLogo} logo
 * @param {string} file
 * @param {string} classes
 */
const renderLogoImage = (logo, file, classes) =>
  html`<img class="${classes}" src="shared/networks/${file}" alt="${logo.name}"${describeLogoStyle(logo)} />`;

/** @param {NetworkLogo} logo */
function describeLogoStyle({ scale, nudge }) {
  const properties = [scale && `--logo-scale: ${scale}`, nudge && `--logo-nudge: ${nudge}`];
  const style = properties.filter(Boolean).join("; ");
  return style ? html` style="${style}"` : html``;
}

// A logo with a version for each background shows the page's.
/** @param {NetworkLogo} logo */
function renderLogo(logo) {
  if (!logo.darkFile) return renderLogoImage(logo, logo.file, "network-logo");
  return html`${renderLogoImage(logo, logo.file, "network-logo for-light")}${renderLogoImage(
    logo,
    logo.darkFile,
    "network-logo for-dark",
  )}`;
}

/** @param {string[]} networks */
const renderNetworkLine = (networks) =>
  html`<div class="networks" role="group" aria-label="Where to watch">
    ${listNetworkLogos(networks).map((network) =>
      typeof network === "string"
        ? html`<span class="network-name">${network}</span>`
        : renderLogo(network),
    )}
  </div>`;

/**
 * Where to watch a game yet to end, as sheet.css lays it out: its channels in one line, logos
 * standing apart by space alone, and a channel without one by its name, or, while none are listed,
 * a note to check back.
 * @param {string[]} networks
 */
export const renderNetworks = (networks) =>
  networks.length
    ? renderNetworkLine(networks)
    : html`<p class="networks networks-pending">Check back for where to watch</p>`;
