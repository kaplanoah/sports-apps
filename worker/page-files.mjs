// An app's page files as its Worker serves them, with the shared page files under shared/,
// where the page's import map points #shared/. Node reads them from disk through the app's
// #page-files/<app> import; the Worker bundle gets the same data embedded by worker/build.mjs.
// The page's index.html also names every module its entry loads, to fetch them all at once.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import { html, joinWithSeparator } from "../shared/page/html.js";
import { nameReleaseFolder } from "../shared/worker/app-worker.js";

const SHARED_PAGE_ROOT = fileURLToPath(new URL("../shared/page/", import.meta.url));

const TEXT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};
const BINARY_TYPES = { ".png": "image/png", ".woff2": "font/woff2" };

function readPageFile(fullPath) {
  const extension = extname(fullPath);
  if (TEXT_TYPES[extension])
    return { contentType: TEXT_TYPES[extension], text: readFileSync(fullPath, "utf8") };
  if (BINARY_TYPES[extension])
    return {
      contentType: BINARY_TYPES[extension],
      base64: readFileSync(fullPath).toString("base64"),
    };
  throw new Error(
    `The Worker doesn't know how to serve ${fullPath}. Add its type to page-files.mjs.`,
  );
}

/** @param {string} pageRoot */
function readFolder(pageRoot) {
  const entries = readdirSync(pageRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Object.fromEntries(
    entries.map((fullPath) => [
      relative(pageRoot, fullPath).split("\\").join("/"),
      readPageFile(fullPath),
    ]),
  );
}

/** @typedef {import("parse5").DefaultTreeAdapterTypes.Element} PageElement */
/** @typedef {{ startOffset: number, endOffset: number, text: string }} PageEdit */

/** @param {string} page */
function listPageElements(page) {
  /** @type {PageElement[]} */
  const elements = [];
  /** @param {import("parse5").DefaultTreeAdapterTypes.Node} node */
  function visitElement(node) {
    if ("tagName" in node && node.namespaceURI === "http://www.w3.org/1999/xhtml")
      elements.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visitElement);
  }
  visitElement(parse(page, { sourceCodeLocationInfo: true }));
  return elements;
}

/** @param {PageElement} element @param {string} name */
const readAttribute = (element, name) =>
  element.attrs.find((attribute) => attribute.name === name)?.value;

/** @param {PageElement} element @param {string} type */
const isScriptType = (element, type) =>
  element.tagName === "script" && readAttribute(element, "type")?.trim().toLowerCase() === type;

/** @param {string} page @param {PageEdit[]} edits */
function applyPageEdits(page, edits) {
  return edits
    .toSorted((left, right) => right.startOffset - left.startOffset)
    .reduce(
      (text, edit) => text.slice(0, edit.startOffset) + edit.text + text.slice(edit.endOffset),
      page,
    );
}

/** @param {string} page @param {PageElement} element */
function readElementText(page, element) {
  const { startTag, endTag } = element.sourceCodeLocation;
  return page.slice(
    startTag.endOffset,
    endTag?.startOffset ?? element.sourceCodeLocation.endOffset,
  );
}
const MODULE_IMPORT =
  /^(?:import\s[^;]*?\sfrom|export\s*(?:\*|\{)[^;]*?\sfrom|import)\s*"([^"]+)"/gm;

/**
 * The page path a module's import names, through the page's import map.
 * @param {string} specifier
 * @param {string} importer the importing module's page path
 * @param {Record<string, string>} imports
 */
function resolveImport(specifier, importer, imports) {
  const prefix = Object.keys(imports).find((key) => specifier.startsWith(key));
  if (prefix) return posix.normalize(imports[prefix] + specifier.slice(prefix.length));
  return specifier.startsWith(".") ? posix.join(posix.dirname(importer), specifier) : null;
}

/**
 * Every module the entry loads, the entry first.
 * @param {Record<string, { text?: string }>} files
 * @param {string} entry
 * @param {Record<string, string>} imports
 */
export function listModules(files, entry, imports) {
  const modules = [entry];
  for (const module of modules) {
    for (const [, specifier] of (files[module]?.text ?? "").matchAll(MODULE_IMPORT)) {
      const path = resolveImport(specifier, module, imports);
      if (path && files[path] && !modules.includes(path)) modules.push(path);
    }
  }
  return modules;
}

// A browser finds each module only once the one importing it has loaded, so the page names them
// all after its import map, and the browser asks for every one at once.
function addModulePreloads(files) {
  const page = files["index.html"]?.text;
  if (!page) return files;
  const elements = listPageElements(page);
  const importMap = elements.find((element) => isScriptType(element, "importmap"));
  const entry = elements.find(
    (element) => isScriptType(element, "module") && readAttribute(element, "src"),
  );
  if (!importMap || !entry) return files;
  const { imports = {} } = JSON.parse(readElementText(page, importMap));
  const links = listModules(files, readAttribute(entry, "src"), imports)
    .map((path) => html`  <link rel="modulepreload" href="${path}" />\n`.text)
    .join("");
  const end = importMap.sourceCodeLocation.endOffset;
  const insertion = page[end] === "\n" ? end + 1 : end;
  const text = applyPageEdits(page, [
    { startOffset: insertion, endOffset: insertion, text: (insertion === end ? "\n" : "") + links },
  ]);
  return { ...files, "index.html": { ...files["index.html"], text } };
}

// Each app's page/js/looks.js names the same files, which tests/page-files.test.js checks.
export const HOME_SCREEN_ICONS = {
  light: "icon-light-180.png",
  dark: "icon-180.png",
  system: "icon-system-180.png",
};

// Only an app whose System icon would show a seam where the two looks' halves meet draws its own.
const isIconKept = (files, look) => look !== "system" || Boolean(files[HOME_SCREEN_ICONS.system]);

/**
 * @param {Record<string, { base64?: string }>} files
 * @param {string} path
 */
function readIconData(files, path) {
  if (!files[path]?.base64) throw new Error(`The page has no ${path} to give the Home Screen.`);
  return files[path].base64;
}

// The icons each look gives the Home Screen, as a stylesheet's properties, which the page has
// before it first draws, so the icons it shows never arrive after the page around them, as on the
// reload a pick of a theme makes.
function addHomeScreenIcons(files) {
  const properties = Object.entries(HOME_SCREEN_ICONS)
    .filter(([look]) => isIconKept(files, look))
    .map(
      ([look, path]) =>
        `  --home-screen-icon-${look}: url("data:image/png;base64,${readIconData(files, path)}");\n`,
    )
    .join("");
  const text = `:root {\n${properties}}\n`;
  return { ...files, "home-screen-icons.css": { contentType: TEXT_TYPES[".css"], text } };
}

/** @param {string} pageRoot the app's page/ folder */
export function readPageFiles(pageRoot) {
  const shared = Object.entries(readFolder(SHARED_PAGE_ROOT)).map(([path, file]) => [
    `shared/${path}`,
    file,
  ]);
  return addModulePreloads(
    addHomeScreenIcons({ ...readFolder(pageRoot), ...Object.fromEntries(shared) }),
  );
}

const isRelative = (address) => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(address);

/** @param {PageElement} element */
const isReleaseGuard = (element) =>
  element.tagName === "script" &&
  element.parentNode.nodeName === "head" &&
  readAttribute(element, "src")?.trim() === "shared/release-guard.js";

/**
 * The URL attribute reading a page file from the release's folder when it loads one.
 * @param {PageElement} element
 * @param {string} folder
 */
function pinFileAttribute(element, folder) {
  const relations = readAttribute(element, "rel")?.toLowerCase().split(/\s+/) ?? [];
  const loadsFile =
    element.tagName === "script" ||
    (element.tagName === "link" &&
      relations.some((relation) => ["stylesheet", "preload", "modulepreload"].includes(relation)));
  if (!loadsFile) return [];
  const name = element.tagName === "script" ? "src" : "href";
  const address = readAttribute(element, name)?.trim();
  if (!address || !isRelative(address)) return [];
  return [
    {
      ...element.sourceCodeLocation.attrs[name],
      text: `${name}="${html`${folder}${address}`.text}"`,
    },
  ];
}

/**
 * The import map, pointing every module path into the release's folder.
 * @param {string} importMap
 * @param {string} folder
 */
function pinImportMap(importMap, folder) {
  const map = JSON.parse(importMap);
  const pinned = Object.entries(map.imports ?? {}).map(([prefix, path]) => [
    prefix,
    isRelative(path) ? `./${folder}${posix.normalize(path)}` : path,
  ]);
  return `\n    ${JSON.stringify({ ...map, imports: Object.fromEntries(pinned) }).replaceAll("<", "\\u003c")}\n  `;
}

// The page and the access code's gate, which the page's address shows until the phone signs in.
/** @param {string} path */
const isPage = (path) => path.endsWith(".html") && !path.includes("/");

/**
 * A page reading its code and styles from the release's folder, with its release guard written in.
 * @param {string} page
 * @param {string} guard
 * @param {string} folder
 */
function pinPage(page, guard, folder) {
  const edits = listPageElements(page).flatMap((element) => {
    const location = element.sourceCodeLocation;
    if (isReleaseGuard(element)) return [{ ...location, text: `<script>\n${guard}</script>` }];
    if (isScriptType(element, "importmap"))
      return [
        {
          startOffset: location.startTag.endOffset,
          endOffset: location.endTag?.startOffset ?? location.endOffset,
          text: pinImportMap(readElementText(page, element), folder),
        },
      ];
    return pinFileAttribute(element, folder);
  });
  return applyPageEdits(page, edits);
}

const CHANNEL_TAG = '<span class="channel-tag" id="channelTag" hidden></span>';

/**
 * The channel tag's channel, commit, and the moment of the deploy, whose age
 * shared/page/draw-channel-tag-age.js draws, or the tag left hidden on production.
 * @param {import("../shared/page/release.js").Release} release
 */
function renderChannelTag({ label, commit, builtAt }) {
  if (!label) return CHANNEL_TAG;
  const facts = joinWithSeparator([label, commit, html`<time datetime="${builtAt}"></time>`]);
  return html`<span class="channel-tag" id="channelTag">${facts}</span>`.text;
}

/**
 * A JSON script tag holding a value, with every < escaped so no text in it can end the tag.
 * @param {string} id
 * @param {unknown} value
 */
export const writeJsonScript = (id, value) =>
  `<script type="application/json" id="${id}">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;

/**
 * A page with its release written in, for its code to read without asking the Worker, and with
 * its channel tag filled from it.
 * @param {string} page
 * @param {import("../shared/page/release.js").Release} release
 */
export function writeRelease(page, release) {
  const edits = listPageElements(page).flatMap((element) => {
    const location = element.sourceCodeLocation;
    if (isReleaseGuard(element))
      return [
        {
          startOffset: location.startOffset,
          endOffset: location.startOffset,
          text: `${writeJsonScript("release", release)}\n  `,
        },
      ];
    if (element.tagName === "span" && readAttribute(element, "id") === "channelTag")
      return [{ ...location, text: renderChannelTag(release) }];
    return [];
  });
  return applyPageEdits(page, edits);
}

/**
 * Each page reading its code and styles from its release's folder, with its release and release
 * guard written in, since the guard has to run when a file from that folder goes missing.
 * @param {Record<string, { contentType: string, text?: string, base64?: string }>} files
 * @param {import("../shared/page/release.js").Release} release
 */
export function pinPageFiles(files, release) {
  const guard = files["shared/release-guard.js"]?.text;
  const folder = nameReleaseFolder(release.commit);
  const pinned = Object.entries(files)
    .filter(([path]) => isPage(path))
    .map(([path, file]) => {
      if (!file.text || !listPageElements(file.text).some(isReleaseGuard) || !guard)
        throw new Error(`The head of ${path} must load shared/release-guard.js.`);
      return [path, { ...file, text: pinPage(writeRelease(file.text, release), guard, folder) }];
    });
  return { ...files, ...Object.fromEntries(pinned) };
}
