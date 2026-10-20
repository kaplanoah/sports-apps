import test from "node:test";
import assert from "node:assert/strict";
import { PLAIN_SCRIPTS } from "../eslint.config.mjs";
import { listApps } from "../worker/apps.mjs";
import { readRepoFile } from "./repo-files.js";

// The build writes it into the head itself, and lint gives it its own block.
const RELEASE_GUARD = "shared/page/release-guard.js";

/** @param {string} app */
const listPlainScripts = (app) =>
  [...readRepoFile(`apps/${app}/page/index.html`).matchAll(/<script src="shared\/([^"]+)">/g)]
    .map(([, name]) => `shared/page/${name}`)
    .filter((path) => path !== RELEASE_GUARD);

// Lint lets these keep what they keep on the device on their own, and reads them as scripts.
for (const app of listApps())
  test(`lint knows every plain script ${app}'s page loads before its modules`, () => {
    assert.deepEqual(listPlainScripts(app).sort(), [...PLAIN_SCRIPTS].sort());
  });
