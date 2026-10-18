import test from "node:test";
import assert from "node:assert/strict";
import { listApps } from "../worker/apps.mjs";
import { labelChannelFiles, listBundledFiles, readRelease } from "../worker/build.mjs";

const BUILT_AT = new Date("2026-10-07T12:00:00Z");
const RELEASE = {
  version: "2.32.2-beta",
  commit: "b102733",
  builtAt: BUILT_AT.toISOString(),
  label: "beta",
};

const readManifest = (files) => JSON.parse(files["manifest.webmanifest"].text);
const readHomeScreenTitle = (files, path) =>
  files[path].text.match(/<meta name="apple-mobile-web-app-title" content="([^"]+)"/)[1];

test("a beta page names itself beta on the Home Screen, and production's doesn't", () => {
  for (const app of listApps()) {
    const production = listBundledFiles(app, { ...RELEASE, version: "2.32.2" });
    const name = readManifest(production).short_name;
    assert.equal(readManifest(production).name, name, app);
    assert.equal(readHomeScreenTitle(production, "index.html"), name, app);
    assert.equal(readHomeScreenTitle(production, "gate.html"), name, app);

    const beta = listBundledFiles(app, RELEASE, "beta");
    assert.equal(readManifest(beta).name, `${name} beta`, app);
    assert.equal(readManifest(beta).short_name, `${name} beta`, app);
    assert.equal(readHomeScreenTitle(beta, "index.html"), `${name} beta`, app);
    assert.equal(readHomeScreenTitle(beta, "gate.html"), `${name} beta`, app);
  }
});

test("labeling leaves every other file as it was", () => {
  const files = {
    "manifest.webmanifest": { contentType: "application/manifest+json", text: '{"name":"X"}' },
    "styles.css": { contentType: "text/css", text: "body {}" },
    "icon.png": { contentType: "image/png", base64: "AAAA" },
  };
  assert.equal(labelChannelFiles(files, null), files);
  const labeled = labelChannelFiles(files, "beta");
  assert.equal(labeled["styles.css"], files["styles.css"]);
  assert.equal(labeled["icon.png"], files["icon.png"]);
});

/** @param {Record<string, string>} answers git's answer to each command, by its arguments */
const createGit = (answers) => (args) => {
  const answer = answers[args.join(" ")];
  if (answer === undefined) throw new Error(`unexpected git ${args.join(" ")}`);
  return answer;
};

test("a beta release counts main's version where its branch left it, and says beta", () => {
  const base = "f".repeat(40);
  const git = createGit({
    "log -1 --format=%h": "b102733\n",
    "merge-base HEAD origin/main": `${base}\n`,
    [`merge-base --is-ancestor 3cf716ccf7c056c3e598a7e4ce82c0c591ac210c ${base}`]: "",
    [`log --first-parent --reverse --format=\x1e%s --name-only --diff-merges=first-parent --no-renames 3cf716ccf7c056c3e598a7e4ce82c0c591ac210c..${base}`]:
      "\x1efeat: something new\napps/mlb/page/js/app.js\n",
  });
  assert.deepEqual(readRelease("mlb", git, BUILT_AT, "beta"), {
    version: "2.33.0-beta",
    commit: "b102733",
    builtAt: BUILT_AT.toISOString(),
    label: "beta",
  });
});

test("a production release has no label, so its page shows no channel tag", () => {
  const git = createGit({
    "log -1 --format=%h": "b102733\n",
    "merge-base --is-ancestor 3cf716ccf7c056c3e598a7e4ce82c0c591ac210c HEAD": "",
    "log --first-parent --reverse --format=\x1e%s --name-only --diff-merges=first-parent --no-renames 3cf716ccf7c056c3e598a7e4ce82c0c591ac210c..HEAD":
      "\x1efeat: something new\napps/mlb/page/js/app.js\n",
  });
  assert.deepEqual(readRelease("mlb", git, BUILT_AT), {
    version: "2.33.0",
    commit: "b102733",
    builtAt: BUILT_AT.toISOString(),
    label: null,
  });
});

test("a beta release with no version to count from still says beta", () => {
  const git = createGit({ "log -1 --format=%h": "b102733\n" });
  assert.equal(readRelease("mlb", git, BUILT_AT, "beta")?.version, "b102733-beta");
});
