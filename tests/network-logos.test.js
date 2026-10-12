import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { listNetworkLogos, NETWORK_LOGOS, renderNetworks } from "../shared/page/network-logos.js";

/** @param {string[]} names */
const listLogos = (names) =>
  /** @type {import("../shared/page/network-logos.js").NetworkLogo[]} */ (listNetworkLogos(names));

const LOGO_FOLDER = new URL("../shared/page/networks/", import.meta.url);

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
  assert.deepEqual(named, readdirSync(LOGO_FOLDER).sort());
});

test("every logo is a PNG or a plain drawing: no scripts, links, or anything it would load", () => {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const file of readdirSync(LOGO_FOLDER)) {
    if (file.endsWith(".png")) {
      assert.deepEqual(
        readFileSync(new URL(file, LOGO_FOLDER)).subarray(0, 8),
        PNG_SIGNATURE,
        file,
      );
      continue;
    }
    const svg = readFileSync(new URL(file, LOGO_FOLDER), "utf8");
    assert.match(svg, /^<svg[^>]*viewBox=/, file);
    assert.doesNotMatch(svg, /<script|\son\w+=|href="(?!#)|url\((?!#)|@import/i, file);
  }
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

test("FOX and FOX One, which share a wordmark, sit at one height in the line", () => {
  const [fox, foxOne] = listLogos(["FOX", "FOX One"]);
  assert.deepEqual([fox.nudge, foxOne.nudge], [-0.04, -0.04]);
  const line = renderNetworksLine(["FOX", "FOX One"]);
  assert.match(line, /alt="FOX" style="--logo-scale: 0\.84; --logo-nudge: -0\.04"/);
  assert.match(line, /alt="FOX One" style="--logo-scale: 0\.86; --logo-nudge: -0\.04"/);
});

test("a game with no channels listed yet says to check back", () => {
  assert.equal(
    renderNetworksLine([]),
    '<p class="networks networks-pending">Check back for where to watch</p>',
  );
});
