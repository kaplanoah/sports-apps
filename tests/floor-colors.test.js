import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { listApps } from "../worker/apps.mjs";
import { readThemeToken } from "./css-rules.js";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";
import { loadThemeHead } from "./theme-head.js";

/**
 * @param {string} app
 * @param {"light" | "dark"} theme
 */
const readFloor = (app, theme) =>
  readThemeToken(fileURLToPath(new URL(`apps/${app}/page/styles.css`, REPO_ROOT)), theme, "--bg");

/**
 * @param {string} app
 * @param {string} name
 */
const readMetaThemeColor = (app, name) =>
  readRepoFile(`apps/${app}/page/${name}`).match(/<meta name="theme-color" content="([^"]+)"/)?.[1];

/** @param {string} app */
const readFloors = (app) => ({ light: readFloor(app, "light"), dark: readFloor(app, "dark") });

test("every app colors the phone's bar each theme's floor before the first paint", () => {
  for (const app of listApps()) {
    for (const theme of /** @type {const} */ (["light", "dark"])) {
      const { barColor } = loadThemeHead({ choice: theme, floors: readFloors(app) });
      assert.equal(barColor.content, readFloor(app, theme), `${app} ${theme}`);
    }
  }
});

test("every app's bar follows a theme picked after the first paint", () => {
  for (const app of listApps()) {
    const { showTheme, barColor } = loadThemeHead({ choice: "light", floors: readFloors(app) });
    showTheme("dark");
    assert.equal(barColor.content, readFloor(app, "dark"), app);
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
