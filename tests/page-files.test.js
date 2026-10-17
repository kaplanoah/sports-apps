import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listApps } from "../worker/apps.mjs";
import {
  HOME_SCREEN_ICONS,
  listModules,
  pinPageFiles,
  readPageFiles,
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

test("the page reads its code and styles from its release's folder, with its release guard written in", () => {
  const files = {
    "index.html": { contentType: "text/html", text: PAGE },
    "shared/release-guard.js": { contentType: "text/javascript", text: "guardPage();\n" },
  };

  const pinned = pinPageFiles(files, "abc1234");

  assert.equal(
    pinned["index.html"].text,
    `<!doctype html>
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

  assert.throws(() => pinPageFiles(files, "abc1234"), /release-guard\.js/);
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
    pinPageFiles(files, "abc1234")["gate.html"].text,
    '<!doctype html>\n  <script>\nguardPage();\n</script>\n  <link rel="stylesheet" href="release/abc1234/shared/gate.css" />\n',
  );
  const unguarded = {
    ...files,
    "gate.html": { contentType: "text/html", text: "<!doctype html>\n" },
  };
  assert.throws(() => pinPageFiles(unguarded, "abc1234"), /The head of gate\.html/);
});

for (const [app, page] of listApps().flatMap((app) => [
  [app, "index.html"],
  [app, "gate.html"],
])) {
  test(`${app}: every file the built ${page} loads is in its release's folder and served`, async () => {
    const { default: files } = await import(`#page-files/${app}`);
    const pinned = pinPageFiles(files, "abc1234")[page].text;
    const loaded = [...pinned.matchAll(/<(?:script|link)\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter(
        (tag) =>
          tag.startsWith("<script") || /rel="(?:stylesheet|preload|modulepreload)"/.test(tag),
      )
      .flatMap((tag) => tag.match(/\b(?:src|href)="([^"]+)"/)?.[1] ?? []);
    assert.ok(loaded.length > 0);
    for (const path of loaded) {
      assert.ok(path.startsWith("release/abc1234/"), path);
      assert.ok(files[path.slice("release/abc1234/".length)], `${path} is served`);
    }
    assert.ok(!pinned.includes("release-guard.js"), "the guard is written in");
  });
}
