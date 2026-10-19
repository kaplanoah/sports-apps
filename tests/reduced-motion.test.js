import test from "node:test";
import assert from "node:assert/strict";
import { listPageSources, readPageSource } from "./page-sources.js";

test("only the shared reduced-motion.js asks the device whether its viewer wants less motion", () => {
  const asking = listPageSources([".js", ".html"]).filter((path) =>
    readPageSource(path).includes("prefers-reduced-motion"),
  );
  assert.deepEqual(asking, ["shared/page/reduced-motion.js"]);
});
