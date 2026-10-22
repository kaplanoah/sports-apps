import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { listApps } from "../worker/apps.mjs";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

const readManifest = (app) => JSON.parse(readRepoFile(`apps/${app}/page/manifest.webmanifest`));

// Chrome offers to install a page only when its manifest has both of these sizes.
test("every app's manifest offers the icons Android needs to install it", () => {
  for (const app of listApps()) {
    const { icons, display } = readManifest(app);
    const sizes = icons.map((icon) => icon.sizes);
    assert.ok(sizes.includes("192x192"), app);
    assert.ok(sizes.includes("512x512"), app);
    assert.equal(display, "standalone", app);
    for (const { src } of icons)
      assert.ok(existsSync(new URL(`apps/${app}/page/${src}`, REPO_ROOT)), src);
  }
});

// An installed app's id is its manifest's start_url, the page's own address, where it has no id of
// its own, so naming one, or moving the start_url, would make Chrome take it for another app.
test("every app's manifest keeps the id installed apps already have, its page's own address", () => {
  for (const app of listApps()) {
    const { id, start_url: startUrl } = readManifest(app);
    assert.equal(id, undefined, app);
    assert.equal(startUrl, "./", app);
  }
});
