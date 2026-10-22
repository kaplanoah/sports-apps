import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { listApps } from "../worker/apps.mjs";
import { readThemeToken } from "./css-rules.js";
import { readRepoFile } from "./repo-files.js";

/**
 * @param {string} app
 * @param {"light" | "dark"} theme
 */
const readFloor = (app, theme) =>
  readThemeToken(
    fileURLToPath(new URL(`../apps/${app}/page/styles.css`, import.meta.url)),
    theme,
    "--bg",
  );

/**
 * @param {string} app
 * @param {string} name
 */
const readMetaThemeColor = (app, name) =>
  readRepoFile(`apps/${app}/page/${name}`).match(/<meta name="theme-color" content="([^"]+)"/)?.[1];

test("every app colors the phone's bar each theme's floor", async () => {
  for (const app of listApps()) {
    const { LOOKS } = await import(`../apps/${app}/page/js/looks.js`);
    assert.equal(LOOKS.light.barColor, readFloor(app, "light"), app);
    assert.equal(LOOKS.dark.barColor, readFloor(app, "dark"), app);
  }
});

test("every app's Home Screen app opens on its dark theme's floor", () => {
  for (const app of listApps()) {
    const manifest = JSON.parse(readRepoFile(`apps/${app}/page/manifest.webmanifest`));
    assert.equal(manifest.background_color, readFloor(app, "dark"), app);
    assert.equal(manifest.theme_color, readFloor(app, "dark"), app);
  }
});

test("every app's page and gate color the phone's bar its dark floor before their scripts run", () => {
  for (const app of listApps()) {
    assert.equal(readMetaThemeColor(app, "index.html"), readFloor(app, "dark"), app);
    assert.equal(readMetaThemeColor(app, "gate.html"), readFloor(app, "dark"), app);
  }
});
