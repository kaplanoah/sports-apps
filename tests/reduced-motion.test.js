import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { listApps } from "../worker/apps.mjs";

const ROOT = new URL("../", import.meta.url);

/** Every script the pages run, as a path from the repository's root. */
const listPageScripts = () =>
  ["shared/page", ...listApps().map((app) => `apps/${app}/page`)].flatMap((folder) =>
    readdirSync(new URL(folder, ROOT), { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".js"))
      .map((name) => `${folder}/${name}`),
  );

test("only the shared reduced-motion.js asks the device whether its viewer wants less motion", () => {
  const asking = listPageScripts().filter((path) =>
    readFileSync(new URL(path, ROOT), "utf8").includes("prefers-reduced-motion"),
  );
  assert.deepEqual(asking, ["shared/page/reduced-motion.js"]);
});
