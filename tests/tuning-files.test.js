import { test } from "node:test";
import assert from "node:assert/strict";
import { listApps } from "../worker/apps.mjs";
import { listBundledFiles } from "../worker/build.mjs";
import { addTuningPanel } from "../worker/tuning-files.mjs";

const ROUND = {
  name: "Team line",
  values: [{ property: "--dot-lift", label: "Dot lift", min: -2, max: 2, step: 0.5, unit: "px" }],
};
const PAGE = '<!doctype html>\n<html>\n<script type="module" src="js/app.js"></script>\n</html>';

const text = (body) => ({ contentType: "text/plain", text: body });
const FILES = {
  "index.html": text(PAGE),
  "gate.html": text(PAGE),
  "tuning-round.json": text(JSON.stringify(ROUND)),
  "shared/tuning-panel.js": text("panel"),
  "shared/tuning-panel.css": text("panel"),
  "shared/tuning-round.js": text("round"),
  "shared/html.js": text("html"),
};
const PANEL_FILES = ["shared/tuning-panel.js", "shared/tuning-panel.css", "shared/tuning-round.js"];

test("production never serves the tuning panel, even while a round is open", () => {
  const files = addTuningPanel(FILES, null);
  for (const path of [...PANEL_FILES, "tuning-round.json"]) assert.equal(files[path], undefined);
  assert.equal(files["index.html"].text, PAGE);
  assert.equal(files["shared/html.js"].text, "html");
});

test("beta loads the tuning panel with its round written into the page", () => {
  const files = addTuningPanel(FILES, "beta");
  const page = files["index.html"].text ?? "";
  assert.match(page, /<script type="module" src="shared\/tuning-panel\.js"><\/script>\n<\/html>$/);
  assert.match(page, /<link rel="stylesheet" href="shared\/tuning-panel\.css" \/>/);
  const round = page.match(/<script type="application\/json" id="tuningRound">(.*)<\/script>/);
  assert.deepEqual(JSON.parse(round?.[1] ?? "null"), ROUND);
  for (const path of PANEL_FILES) assert.ok(files[path], path);
  assert.equal(files["tuning-round.json"], undefined);
  assert.equal(files["gate.html"].text, PAGE);
});

test("beta loads no tuning panel while no round is open", () => {
  const { "tuning-round.json": _round, ...withoutRound } = FILES;
  const files = addTuningPanel(withoutRound, "beta");
  for (const path of PANEL_FILES) assert.equal(files[path], undefined);
  assert.equal(files["index.html"].text, PAGE);
});

test("a round's text can't end the script that holds it", () => {
  const round = { ...ROUND, name: "</script><b>" };
  const files = addTuningPanel(
    { ...FILES, "tuning-round.json": text(JSON.stringify(round)) },
    "beta",
  );
  const page = files["index.html"].text ?? "";
  assert.equal(page.match(/<\/script>/g)?.length, 3);
  assert.match(page, /\\u003c\/script>\\u003cb>/);
});

test("each app's production build leaves the tuning panel out", () => {
  for (const app of listApps()) {
    const files = listBundledFiles(app, null);
    for (const path of PANEL_FILES) assert.equal(files[path], undefined, `${app} ${path}`);
    assert.doesNotMatch(files["index.html"].text ?? "", /tuning/, app);
  }
});
