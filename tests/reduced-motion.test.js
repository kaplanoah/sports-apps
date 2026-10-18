import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listPageSources } from "./page-sources.js";

test("only the shared reduced-motion.js asks the device whether its viewer wants less motion", () => {
  const asking = listPageSources([".js"]).filter((path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8").includes("prefers-reduced-motion"),
  );
  assert.deepEqual(asking, ["shared/page/reduced-motion.js"]);
});
