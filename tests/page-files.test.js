import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "parse5";
import { listApps } from "../worker/apps.mjs";
import { REPO_ROOT } from "./repo-files.js";
import {
  HOME_SCREEN_ICONS,
  listModules,
  pinPageFiles,
  readPageFiles,
  writeRelease,
} from "../worker/page-files.mjs";

const IMPORTS = { "#shared/": "./shared/" };

test("the modules an entry loads are found through every kind of import, once each", () => {
  const files = {
    "js/app.js": {
      text: [
        'import { html } from "#shared/html.js";',
        "import {",
        "  renderGames,",
        "  renderTable,",
        '} from "./views/games.js";',
        'import "./side-effect.js";',
      ].join("\n"),
    },
    "js/views/games.js": {
      text: 'export { html } from "#shared/html.js";\nexport * from "../clubs.js";\n',
    },
    "js/clubs.js": { text: '/** @typedef {import("./types.js").Club} Club */\n' },
    "js/side-effect.js": { text: "" },
    "shared/html.js": { text: 'import "https://example.com/elsewhere.js";\n' },
    "js/unused.js": { text: "" },
  };
  assert.deepEqual(listModules(files, "js/app.js", IMPORTS), [
    "js/app.js",
    "shared/html.js",
    "js/views/games.js",
    "js/side-effect.js",
    "js/clubs.js",
  ]);
});

for (const app of listApps()) {
  test(`${app}: the page names its modules after the import map and before its entry`, async () => {
    const { default: files } = await import(`#page-files/${app}`);
    const page = files["index.html"].text;
    const preloads = [...page.matchAll(/<link rel="modulepreload" href="([^"]+)" \/>/g)];
    const paths = preloads.map(([, path]) => path);
    assert.equal(paths[0], "js/app.js");
    assert.ok(paths.includes("shared/html.js"));
    assert.ok(
      paths.every((path) => files[path]),
      "every named module is served",
    );
    assert.ok(page.indexOf('<script type="importmap">') < preloads[0].index);
    assert.ok(preloads.at(-1).index < page.indexOf('<script type="module" src="js/app.js">'));
  });

  test(`${app}: the page loads each icon its theme choices show before its welcome, from the app's own PNGs`, async () => {
    const { default: files } = await import(`#page-files/${app}`);
    const page = files["index.html"].text;
    const icons = files["home-screen-icons.css"].text;
    const readIcon = (look) =>
      icons.match(
        new RegExp(`--home-screen-icon-${look}: url\\("data:image/png;base64,([^"]+)"\\)`),
      )?.[1];
    const CHOICE_LOOKS = {
      light: ["light"],
      dark: ["dark"],
      system: ["system"],
      halves: ["light", "dark"],
    };
    const shownLooks = [
      ...page.matchAll(/class="appearance-icon appearance-icon-([a-z]+)"/g),
    ].flatMap(([, choice]) => CHOICE_LOOKS[choice]);
    assert.ok(shownLooks.length > 0);
    for (const look of shownLooks)
      assert.ok(
        readIcon(look) === files[HOME_SCREEN_ICONS[look]].base64,
        `${look} is ${HOME_SCREEN_ICONS[look]}`,
      );
    const iconsLink = page.indexOf('<link rel="stylesheet" href="home-screen-icons.css" />');
    assert.ok(iconsLink >= 0 && iconsLink < page.indexOf('<dialog id="homeScreenWelcome"'));
  });

  test(`${app}: the icons the page draws for each look are the ones it gives the Home Screen`, async () => {
    const { LOOKS } = await import(`../apps/${app}/page/js/looks.js`);
    assert.equal(LOOKS.light.homeScreenIcon, HOME_SCREEN_ICONS.light);
    assert.equal(LOOKS.dark.homeScreenIcon, HOME_SCREEN_ICONS.dark);
  });
}

test("a page without its light or dark Home Screen icon isn't built", () => {
  const pageRoot = mkdtempSync(join(tmpdir(), "page-"));
  writeFileSync(join(pageRoot, "index.html"), "<!doctype html>\n");
  writeFileSync(join(pageRoot, HOME_SCREEN_ICONS.light), "png");
  assert.throws(() => readPageFiles(pageRoot), /no icon-180\.png/);
});

const PAGE = `<!doctype html>
  <script src="shared/release-guard.js"></script>
  <link rel="manifest" href="manifest.webmanifest" />
  <link
    rel="preload"
    href="fonts/text.woff2"
    as="font"
    crossorigin
  />
  <link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="https://fonts.example/text.css" />
  <script src="shared/open-last-tab.js"></script>
  <script type="importmap">
    { "imports": { "#shared/": "./shared/" } }
  </script>
  <link rel="modulepreload" href="js/app.js" />
  <img src="icon-180.png" alt="" />
  <script type="module" src="js/app.js"></script>
`;

const RELEASE = {
  version: "2.33.0",
  commit: "abc1234",
  builtAt: "2026-10-18T20:00:00.000Z",
  label: null,
};
const BETA_RELEASE = { ...RELEASE, version: "2.33.0-beta", label: "beta" };
const WRITTEN_RELEASE = `<script type="application/json" id="release">${JSON.stringify(RELEASE)}</script>`;
const HIDDEN_TAG = '<span class="channel-tag" id="channelTag" hidden></span>';

test("the page reads its code and styles from its release's folder, with its release and release guard written in", () => {
  const files = {
    "index.html": { contentType: "text/html", text: PAGE },
    "shared/release-guard.js": { contentType: "text/javascript", text: "guardPage();\n" },
  };

  const pinned = pinPageFiles(files, RELEASE);

  assert.equal(
    pinned["index.html"].text,
    `<!doctype html>
  ${WRITTEN_RELEASE}
  <script>
guardPage();
</script>
  <link rel="manifest" href="manifest.webmanifest" />
  <link
    rel="preload"
    href="release/abc1234/fonts/text.woff2"
    as="font"
    crossorigin
  />
  <link rel="stylesheet" href="release/abc1234/styles.css" />
  <link rel="stylesheet" href="https://fonts.example/text.css" />
  <script src="release/abc1234/shared/open-last-tab.js"></script>
  <script type="importmap">
    {"imports":{"#shared/":"./release/abc1234/shared/"}}
  </script>
  <link rel="modulepreload" href="release/abc1234/js/app.js" />
  <img src="icon-180.png" alt="" />
  <script type="module" src="release/abc1234/js/app.js"></script>
`,
  );
  assert.equal(pinned["shared/release-guard.js"], files["shared/release-guard.js"]);
});

test("a page whose head doesn't load the release guard isn't built", () => {
  const files = { "index.html": { contentType: "text/html", text: "<!doctype html>\n" } };

  assert.throws(() => pinPageFiles(files, RELEASE), /release-guard\.js/);
});

function pinFixture(page) {
  const files = {
    "index.html": { contentType: "text/html", text: page },
    "shared/release-guard.js": { contentType: "text/javascript", text: "guardPage();\n" },
  };
  return pinPageFiles(files, RELEASE)["index.html"].text;
}

function listParsedNodes(page) {
  /** @type {import("parse5").DefaultTreeAdapterTypes.Node[]} */
  const nodes = [parse(page)];
  for (const node of nodes) if ("childNodes" in node) nodes.push(...node.childNodes);
  return nodes;
}

const FIELD_TAGS = new Set(["input", "select", "textarea"]);

/**
 * The fields in `page` hidden with `hidden`, which takes them from VoiceOver and the keyboard.
 * @param {string} page
 */
const listHiddenFields = (page) =>
  listParsedNodes(page).filter(
    (node) =>
      "tagName" in node &&
      FIELD_TAGS.has(node.tagName) &&
      node.attrs.some(({ name }) => name === "hidden") &&
      !node.attrs.some(({ name, value }) => name === "type" && value === "hidden"),
  );

test("a hidden field is found in a page's markup, but a hidden button or form value isn't", () => {
  const page = `<label><input type="file" HIDDEN></label><select hidden=""></select>
<button hidden></button><input type="hidden" name="season"><input data-note="hidden">`;
  assert.deepEqual(
    listHiddenFields(page).map((node) => "tagName" in node && node.tagName),
    ["select", "input"],
  );
});

for (const app of listApps())
  for (const name of ["index.html", "gate.html"])
    test(`${app}: ${name} hides no field with hidden`, () => {
      const page = readFileSync(new URL(`apps/${app}/page/${name}`, REPO_ROOT), "utf8");
      assert.deepEqual(listHiddenFields(page), []);
    });

for (const [tag, expected] of [
  ['<SCRIPT SRC="js/app.js"></SCRIPT>', '<SCRIPT src="release/abc1234/js/app.js"></SCRIPT>'],
  ["<ScRiPt src='js/app.js'></ScRiPt>", '<ScRiPt src="release/abc1234/js/app.js"></ScRiPt>'],
  ["<script src=js/app.js></script>", '<script src="release/abc1234/js/app.js"></script>'],
  [
    '<LINK HREF="styles.css" REL="alternate StyleSheet">',
    '<LINK href="release/abc1234/styles.css" REL="alternate StyleSheet">',
  ],
  [
    "<link rel=preload href='fonts/text.woff2'>",
    '<link rel=preload href="release/abc1234/fonts/text.woff2">',
  ],
  [
    '<script data-note=">" data-src="decoy.js" src="js/app.js"></script>',
    '<script data-note=">" data-src="decoy.js" src="release/abc1234/js/app.js"></script>',
  ],
  [
    '<link rel="stylesheet" href="styles.css?a=1&amp;b=2">',
    '<link rel="stylesheet" href="release/abc1234/styles.css?a=1&amp;b=2">',
  ],
]) {
  test(`release pinning follows HTML syntax: ${tag}`, () => {
    assert.equal(
      pinFixture('<script src="shared/release-guard.js"></script>\n' + tag)
        .split("\n")
        .at(-1),
      expected,
    );
  });
}

test("release pinning leaves comments, raw text, templates, foreign elements and nonlocal URLs untouched", () => {
  const untouched = `<!-- <script src="decoy.js"></script> -->
<script>const example = '<script src="decoy.js">';</script>
<textarea><link rel="stylesheet" href="decoy.css"></textarea>
<template><script src="decoy.js"></script></template>
<svg><script src="decoy.js"></script></svg>
<link rel="icon" href="icon.svg">
<link rel="stylesheet" href="&#104;ttps://example.com/styles.css">
<script src="//example.com/app.js"></script>
<script src="&#47;app.js"></script>
<script src=" https://example.com/app.js "></script>`;
  assert.ok(
    pinFixture('<script src="shared/release-guard.js"></script>\n' + untouched).endsWith(untouched),
  );
});

test("release guards and import maps use real HTML elements with any valid attribute syntax", () => {
  const page = `<SCRIPT data-note=">" SRC='shared/release-guard.js'></SCRIPT>
<SCRIPT TYPE=importmap>{"imports":{"#shared/":"./shared/"}}</SCRIPT>`;
  assert.equal(
    pinFixture(page),
    `${WRITTEN_RELEASE}\n  <script>\nguardPage();\n</script>
<SCRIPT TYPE=importmap>\n    {"imports":{"#shared/":"./release/abc1234/shared/"}}\n  </SCRIPT>`,
  );
  for (const page of [
    '<!-- <script src="shared/release-guard.js"></script> -->',
    "<script>const example = '<script src=\"shared/release-guard.js\">';</script>",
    '<template><script src="shared/release-guard.js"></script></template>',
    '<p>Content</p><script src="shared/release-guard.js"></script>',
  ])
    assert.throws(() => pinFixture(page), /release-guard\.js/);
});

test("module preloads follow parsed import maps and entry scripts without rewriting their lookalikes", (context) => {
  const pageRoot = mkdtempSync(join(tmpdir(), "page-html-"));
  context.after(() => rmSync(pageRoot, { recursive: true, force: true }));
  const decoy = '<!-- <script type="importmap">not JSON</script> -->';
  writeFileSync(
    join(pageRoot, "index.html"),
    `${decoy}\n<SCRIPT TYPE='importmap'>{"imports":{}}</SCRIPT><SCRIPT TYPE=module SRC='app&quot;&amp;.js'></SCRIPT>`,
  );
  writeFileSync(join(pageRoot, 'app"&.js'), "export const value = 1;\n");
  writeFileSync(join(pageRoot, HOME_SCREEN_ICONS.light), "png");
  writeFileSync(join(pageRoot, HOME_SCREEN_ICONS.dark), "png");
  assert.equal(
    readPageFiles(pageRoot)["index.html"].text,
    `${decoy}\n<SCRIPT TYPE='importmap'>{"imports":{}}</SCRIPT>\n  <link rel="modulepreload" href="app&quot;&amp;.js" />\n<SCRIPT TYPE=module SRC='app&quot;&amp;.js'></SCRIPT>`,
  );
});

test("rewriting import maps cannot turn a JSON string into a closing script tag", () => {
  const pinned = pinFixture(
    '<script src="shared/release-guard.js"></script>\n<script type=importmap>{"imports":{"<\\/script>":"./shared/"}}</script>',
  );
  const nodes = listParsedNodes(pinned);
  const map = nodes.find(
    (node) =>
      "attrs" in node &&
      node.attrs.some(({ name, value }) => name === "type" && value === "importmap"),
  );
  assert.ok(map && "childNodes" in map);
  const text = map.childNodes.map((node) => ("value" in node ? node.value : "")).join("");
  assert.deepEqual(JSON.parse(text), { imports: { "</script>": "./release/abc1234/shared/" } });
});

test("release import maps retain the existing imports-only contract", () => {
  const page =
    '<script src="shared/release-guard.js"></script>\n<script type=importmap>{"imports":{"#shared/":"./shared/"},"scopes":{"./":{"example":"./example.js"}}}</script>';
  const pinned = pinFixture(page);
  const nodes = listParsedNodes(pinned);
  const map = nodes.find(
    (node) =>
      "attrs" in node &&
      node.attrs.some(({ name, value }) => name === "type" && value === "importmap"),
  );
  assert.ok(map && "childNodes" in map);
  assert.deepEqual(
    JSON.parse(map.childNodes.map((node) => ("value" in node ? node.value : "")).join("")),
    { imports: { "#shared/": "./release/abc1234/shared/" } },
  );
  assert.throws(
    () =>
      pinFixture(
        '<script src="shared/release-guard.js"></script>\n<script type=importmap>{}</script>',
      ),
    TypeError,
  );
});

test("every page at the folder's top is pinned, the gate too, and each must load the guard", () => {
  const gate =
    '<!doctype html>\n  <script src="shared/release-guard.js"></script>\n  <link rel="stylesheet" href="shared/gate.css" />\n';
  const files = {
    "index.html": { contentType: "text/html", text: PAGE },
    "gate.html": { contentType: "text/html", text: gate },
    "shared/release-guard.js": { contentType: "text/javascript", text: "guardPage();\n" },
  };

  assert.equal(
    pinPageFiles(files, RELEASE)["gate.html"].text,
    `<!doctype html>\n  ${WRITTEN_RELEASE}\n  <script>\nguardPage();\n</script>\n  <link rel="stylesheet" href="release/abc1234/shared/gate.css" />\n`,
  );
  const unguarded = {
    ...files,
    "gate.html": { contentType: "text/html", text: "<!doctype html>\n" },
  };
  assert.throws(() => pinPageFiles(unguarded, RELEASE), /The head of gate\.html/);
});

for (const [app, page] of listApps().flatMap((app) => [
  [app, "index.html"],
  [app, "gate.html"],
])) {
  test(`${app}: every file the built ${page} loads is in its release's folder and served`, async () => {
    const { default: files } = await import(`#page-files/${app}`);
    const pinned = pinPageFiles(files, RELEASE)[page].text;
    const nodes = listParsedNodes(pinned);
    const loaded = nodes.flatMap((node) => {
      if (!("tagName" in node)) return [];
      const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (node.tagName === "script") return attributes.src ?? [];
      if (
        node.tagName === "link" &&
        attributes.rel
          ?.split(/\s+/)
          .some((relation) => ["stylesheet", "preload", "modulepreload"].includes(relation))
      )
        return attributes.href ?? [];
      return [];
    });
    assert.ok(loaded.length > 0);
    for (const path of loaded) {
      assert.ok(path.startsWith("release/abc1234/"), path);
      assert.ok(files[path.slice("release/abc1234/".length)], `${path} is served`);
    }
    assert.ok(!pinned.includes("release-guard.js"), "the guard is written in");
  });
}

const TAGGED_PAGE = `<script src="shared/release-guard.js"></script>\n${HIDDEN_TAG}\n`;

test("a beta page's tag names its channel, its commit, and the moment it went live, shown as the page opens", () => {
  assert.equal(
    writeRelease(TAGGED_PAGE, BETA_RELEASE).split("\n")[2],
    '<span class="channel-tag" id="channelTag"><span class="fact">beta<span class="sep">&bull;</span></span><span class="fact">abc1234<span class="sep">&bull;</span></span><span class="fact"><time datetime="2026-10-18T20:00:00.000Z"></time></span></span>',
  );
});

test("production's tag stays hidden and empty", () => {
  assert.equal(writeRelease(TAGGED_PAGE, RELEASE).split("\n")[2], HIDDEN_TAG);
});

test("the release written into a page can't end its script", () => {
  const release = { ...BETA_RELEASE, label: "</script><b>" };
  const written = writeRelease(TAGGED_PAGE, release);
  const script = written.match(/<script type="application\/json" id="release">(.*?)<\/script>/);
  assert.deepEqual(JSON.parse(script?.[1] ?? "null"), release);
});

for (const app of listApps()) {
  test(`${app}: the page holds the tag the build fills and draws its age before the first paint`, async () => {
    const { default: files } = await import(`#page-files/${app}`);
    const page = files["index.html"].text;
    const tag = page.indexOf(HIDDEN_TAG);
    const headScript = page.indexOf('<script src="shared/draw-channel-tag-age.js"></script>');
    assert.ok(tag >= 0);
    assert.ok(headScript >= 0 && headScript < tag);
    assert.ok(page.indexOf("drawChannelTagAge();") > tag);
  });
}

for (const app of listApps()) {
  test(`${app}: final page and gate scripts match their CSP hashes after release rewriting`, async () => {
    const { createHash } = await import("node:crypto");
    const { listBundledFiles } = await import("../worker/build.mjs");
    const { createAppWorker } = await import("../shared/worker/app-worker.js");
    const files = listBundledFiles(app, {
      version: "1.0.0",
      commit: "abc1234",
      builtAt: "2026-10-29T12:00:00Z",
      label: null,
    });
    const worker = createAppWorker({
      name: app,
      pageFiles: files,
      forwardToStore: () => new Response(),
      readFeedFailures: async () => ({}),
    });
    for (const path of ["index.html", "gate.html"]) {
      const page = files[path].text;
      const scripts = listParsedNodes(page).flatMap((node) => {
        if (!("tagName" in node) || node.tagName !== "script") return [];
        const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
        if ("src" in attributes || attributes.type === "application/json") return [];
        return node.childNodes.map((child) => ("value" in child ? child.value : "")).join("");
      });
      assert.ok(scripts.length > 0);
      const response = await worker.fetch(new Request(`https://worker.example/k3y/${path}`), {
        APP_KEY: "k3y",
      });
      const policy = response.headers.get("content-security-policy");
      for (const script of scripts) {
        const hash = createHash("sha256").update(script).digest("base64");
        assert.ok(policy.includes(`'sha256-${hash}'`), path);
      }
      assert.ok(policy.includes("frame-ancestors 'none'"));
      assert.ok(policy.includes("script-src-attr 'none'"));
      assert.ok(!/script-src[^;]*unsafe-inline/.test(policy));
      const cached = await worker.fetch(
        new Request(`https://worker.example/k3y/${path}`, {
          headers: { "if-none-match": response.headers.get("etag") },
        }),
        { APP_KEY: "k3y" },
      );
      assert.equal(cached.status, 304);
      assert.equal(cached.headers.get("content-security-policy"), policy);
    }
  });
}
