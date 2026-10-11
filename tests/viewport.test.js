import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { listApps } from "../worker/apps.mjs";

const listPages = (app) => {
  const folder = new URL(`../apps/${app}/page/`, import.meta.url);
  return readdirSync(folder)
    .filter((name) => name.endsWith(".html"))
    .map((name) => ({
      name: `${app}/${name}`,
      markup: readFileSync(new URL(name, folder), "utf8"),
    }));
};

const readViewport = (markup) =>
  markup.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1].split(/,\s*/) ?? [];

// A Home Screen app keeps an iPhone from pinching past a maximum-scale, so the fields set 16px,
// which it doesn't zoom into on a tap, rather than capping the scale.
test("every app's page lets a pinch zoom it", () => {
  for (const app of listApps())
    for (const { name, markup } of listPages(app)) {
      const viewport = readViewport(markup);
      assert.ok(viewport.includes("width=device-width"), name);
      assert.ok(!viewport.some((setting) => /^(maximum-scale|user-scalable)=/.test(setting)), name);
    }
});
