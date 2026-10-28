import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readThemeToken } from "./css-rules.js";
import { readPngPixels } from "./png-pixels.js";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";
import {
  describeChannel,
  listNetworkLogos,
  NETWORK_LOGOS,
  renderNetworks,
} from "../shared/page/network-logos.js";

/** @param {string[]} names */
const listLogos = (names) =>
  /** @type {import("../shared/page/network-logos.js").NetworkLogo[]} */ (listNetworkLogos(names));

const LOGO_FOLDER = "shared/page/networks/";

/** @param {string[]} networks */
const renderNetworksLine = (networks) => String(renderNetworks(networks));

test("a channel's logo is found by any name the feeds give it, whatever its case", () => {
  const logos = listNetworkLogos(["NBC", "nbcsn", "peacock", "prime video", "USA Net"]);
  assert.deepEqual(
    logos.map((logo) => typeof logo === "object" && logo.name),
    ["NBC", "NBCSN", "Peacock", "Prime Video", "USA Network"],
  );
});

test("two names for one channel show its logo once, and a channel with no logo keeps its name", () => {
  const [usa, ...rest] = /** @type {any[]} */ (
    listNetworkLogos(["USA Network", "USA Net", "ION", "WNBA League Pass"])
  );
  assert.equal(usa.name, "USA Network");
  assert.deepEqual(rest, ["ION", "WNBA League Pass"]);
});

test("each channel MLB's playoffs are on has its logo, whatever the case MLB writes it in", () => {
  const logos = listNetworkLogos(["FOX", "FS1", "FOX ONE", "TBS", "HBO MAX", "Apple TV"]);
  assert.deepEqual(
    logos.map((logo) => typeof logo === "object" && logo.name),
    ["FOX", "FS1", "FOX One", "TBS", "HBO Max", "Apple TV"],
  );
});

test("MLB Network and SNY show their logos, SNY's with a version for a dark page", () => {
  const [mlbNetwork, sny] = listLogos(["MLB Network", "SNY"]);
  assert.deepEqual([mlbNetwork.file, mlbNetwork.darkFile], ["mlb-network.png", undefined]);
  assert.deepEqual([sny.file, sny.darkFile], ["sny.png", "sny-dark.png"]);
});

test("a logo that works on one background has a version for the other", () => {
  const [nbc, espn] = listLogos(["NBC", "ESPN"]);
  assert.deepEqual([nbc.file, nbc.darkFile], ["nbc.svg", "nbc-dark.svg"]);
  assert.deepEqual([espn.file, espn.darkFile], ["espn.svg", undefined]);
});

test("a square badge is drawn taller than a long wordmark, so the two look about the same size", () => {
  const [abc, espn] = listLogos(["ABC", "ESPN"]);
  assert.ok(abc.scale > 1 && espn.scale < 1);
  const line = renderNetworksLine(["ABC", "ESPN"]);
  assert.match(line, new RegExp(`alt="ABC" style="--logo-scale: ${abc.scale}; --logo-nudge: `));
  assert.match(line, new RegExp(`alt="ESPN" style="--logo-scale: ${espn.scale}; --logo-nudge: `));
});

test("every logo the table names is in its folder, and every file there is one it names", () => {
  const named = NETWORK_LOGOS.flatMap((logo) => [logo.file, logo.darkFile ?? []].flat()).sort();
  assert.deepEqual(named, readdirSync(new URL(LOGO_FOLDER, REPO_ROOT)).sort());
});

test("every logo is a PNG or a plain drawing: no scripts, links, or anything it would load", () => {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const file of readdirSync(new URL(LOGO_FOLDER, REPO_ROOT))) {
    if (file.endsWith(".png")) {
      assert.deepEqual(
        readFileSync(new URL(`${LOGO_FOLDER}${file}`, REPO_ROOT)).subarray(0, 8),
        PNG_SIGNATURE,
        file,
      );
      continue;
    }
    const svg = readRepoFile(`${LOGO_FOLDER}${file}`);
    assert.match(svg, /^<svg[^>]*viewBox=/, file);
    assert.doesNotMatch(svg, /<script|\son\w+=|href="(?!#)|url\((?!#)|@import/i, file);
  }
});

const WALNUT_INK = readThemeToken(
  fileURLToPath(new URL("apps/wnba/page/styles.css", REPO_ROOT)),
  "dark",
  "--ink",
);

/** @param {string} file */
const listDrawingColors = (file) =>
  new Set(
    [
      ...readRepoFile(`${LOGO_FOLDER}${file}`).matchAll(
        /(?:fill|stroke|stop-color)\s*[=:]\s*"?(#[0-9a-f]{3,6})/gi,
      ),
    ].map(([, color]) => color.toLowerCase()),
  );

/** @param {number[]} pixel */
const formatHex = (pixel) =>
  `#${pixel
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;

/** @param {number[]} pixel */
const isOpaque = (pixel) => pixel[3] === 255;

/**
 * A picture's most common color where it's opaque.
 * @param {string} file
 */
function readMainColor(file) {
  const counts = new Map();
  for (const pixel of readPngPixels(new URL(`${LOGO_FOLDER}${file}`, REPO_ROOT)).filter(isOpaque)) {
    const color = formatHex(pixel);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return [...counts].sort(([, first], [, second]) => second - first)[0][0];
}

test("every color a dark drawing of a logo adds to its light one is the WNBA's Walnut ink", () => {
  for (const file of readdirSync(new URL(LOGO_FOLDER, REPO_ROOT)).filter((name) =>
    name.endsWith("-dark.svg"),
  )) {
    const light = listDrawingColors(file.replace("-dark", ""));
    const added = [...listDrawingColors(file)].filter((color) => !light.has(color));
    assert.deepEqual(added, [WALNUT_INK], file);
  }
});

/** @param {string} color */
function isNearBlack(color) {
  const digits = color.slice(1);
  const fullDigits = digits.length === 3 ? digits.replace(/./g, "$&$&") : digits;
  const channels = fullDigits.match(/../g) ?? [];
  return channels.every((channel) => parseInt(channel, 16) < 0x40);
}

test("no dark drawing of a logo keeps a near-black, which would vanish on a dark page", () => {
  for (const file of readdirSync(new URL(LOGO_FOLDER, REPO_ROOT)).filter((name) =>
    name.endsWith("-dark.svg"),
  ))
    assert.deepEqual([...listDrawingColors(file)].filter(isNearBlack), [], file);
});

test("every dark picture of a logo draws its cream, its main color, in the WNBA's Walnut ink", () => {
  for (const file of readdirSync(new URL(LOGO_FOLDER, REPO_ROOT)).filter((name) =>
    name.endsWith("-dark.png"),
  ))
    assert.equal(readMainColor(file), WALNUT_INK, file);
});

test("the line of channels shows each logo, its dark version beside it, and names without one, apart by space alone", () => {
  const line = renderNetworksLine(["NBC", "ESPN", "ION"]);
  const images = [...line.matchAll(/<img class="([^"]*)" src="([^"]*)" alt="([^"]*)"/g)].map(
    ([, classes, source, alt]) => [classes, source, alt],
  );
  assert.deepEqual(images, [
    ["network-logo for-light", "shared/networks/nbc.svg", "NBC"],
    ["network-logo for-dark", "shared/networks/nbc-dark.svg", "NBC"],
    ["network-logo", "shared/networks/espn.svg", "ESPN"],
  ]);
  assert.match(line, /<span class="network-name">ION<\/span>/);
  assert.doesNotMatch(line, /class="sep"/);
  assert.match(line, /^<div class="networks" role="group" aria-label="Where to watch">/);
});

test("a logo whose weight sits low is nudged up, one whose weight sits high is nudged down, and one centered isn't", () => {
  const [nbc, espn, usa] = listLogos(["NBC", "ESPN", "USA Network"]);
  assert.ok(nbc.nudge > 0 && espn.nudge < 0);
  assert.equal(usa.nudge, undefined);
  assert.match(renderNetworksLine(["NBC"]), /style="--logo-scale: [\d.]+; --logo-nudge: [\d.]+"/);
});

// Where each channel's file draws the wordmark it shares with another's, from its top and its
// bottom as shares of its height, measured from the files.
const SHARED_WORDMARKS = [
  { FOX: [0, 1], "FOX One": [0, 1] },
  { ESPN: [0, 1], ESPN2: [0, 1] },
  { NBC: [15.1 / 52.9, 51.92 / 52.9], NBCSN: [27.67 / 263, 201.8 / 263] },
];

/**
 * Where a logo draws part of itself in the line, from the line's middle, in logo heights.
 * @param {import("../shared/page/network-logos.js").NetworkLogo} logo
 * @param {number[]} span
 */
function placeInLine({ scale = 1, nudge = 0 }, span) {
  const top = -scale * nudge - scale / 2;
  return span.map((share) => top + share * scale);
}

test("channels that share a wordmark draw it at one size and one height in the line", () => {
  for (const spans of SHARED_WORDMARKS) {
    const names = Object.keys(spans);
    const [first, ...rest] = listLogos(names).map((logo, index) =>
      placeInLine(logo, spans[names[index]]),
    );
    for (const placed of rest) {
      placed.forEach((edge, index) =>
        assert.ok(Math.abs(edge - first[index]) < 0.001, names.join()),
      );
    }
  }
});

test("a game with no channels listed yet says to check back", () => {
  assert.equal(
    renderNetworksLine([]),
    '<p class="networks networks-pending">Check back for where to watch</p>',
  );
});

test("a listing names its channel, with every word fans call it, or its own name without a logo", () => {
  assert.deepEqual(describeChannel("USA Net"), {
    name: "USA Network",
    words: ["USA Network", "USA Net", "usa"],
  });
  assert.deepEqual(describeChannel("prime video").words, [
    "Prime Video",
    "prime",
    "amazon",
    "amazon prime",
  ]);
  assert.deepEqual(describeChannel("ION"), { name: "ION", words: ["ION"] });
});
