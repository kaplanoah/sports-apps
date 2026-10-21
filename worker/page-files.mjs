// An app's page files as its Worker serves them, with the shared page files under shared/,
// where the page's import map points #shared/. Node reads them from disk through the app's
// #page-files/<app> import; the Worker bundle gets the same data embedded by worker/build.mjs.
// The page's index.html also names every module its entry loads, to fetch them all at once.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
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

const IMPORT_MAP = /<script type="importmap">([\s\S]*?)<\/script>\n/;
const ENTRY_MODULE = /<script type="module" src="([^"]+)"><\/script>/;
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
  const importMap = page?.match(IMPORT_MAP);
  const entry = page?.match(ENTRY_MODULE)?.[1];
  if (!importMap || !entry) return files;
  const { imports } = JSON.parse(importMap[1]);
  const links = listModules(files, entry, imports)
    .map((path) => `  <link rel="modulepreload" href="${path}" />\n`)
    .join("");
  const text = page.replace(importMap[0], importMap[0] + links);
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

const RELEASE_GUARD = '<script src="shared/release-guard.js"></script>';
const LOADING_TAG = /<(?:link|script)\b[^>]*>/g;
const LOADED_LINK = /\brel="(?:stylesheet|preload|modulepreload)"/;
const FILE_ATTRIBUTE = /\b(href|src)="([^"]+)"/;
const isRelative = (address) => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(address);

/**
 * A link or script tag, reading a page file from the release's folder when it loads one.
 * @param {string} tag
 * @param {string} folder
 */
function pinTag(tag, folder) {
  if (tag.startsWith("<link") && !LOADED_LINK.test(tag)) return tag;
  return tag.replace(FILE_ATTRIBUTE, (attribute, name, address) =>
    isRelative(address) ? `${name}="${folder}${address}"` : attribute,
  );
}

/**
 * The import map, pointing every module path into the release's folder.
 * @param {string} importMap
 * @param {string} folder
 */
function pinImportMap(importMap, folder) {
  const { imports } = JSON.parse(importMap);
  const pinned = Object.entries(imports).map(([prefix, path]) => [
    prefix,
    isRelative(path) ? `./${folder}${posix.normalize(path)}` : path,
  ]);
  return `\n    ${JSON.stringify({ imports: Object.fromEntries(pinned) })}\n  `;
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
const pinPage = (page, guard, folder) =>
  page
    .replace(RELEASE_GUARD, () => `<script>\n${guard}</script>`)
    .replace(IMPORT_MAP, (tag, importMap) =>
      tag.replace(importMap, pinImportMap(importMap, folder)),
    )
    .replace(LOADING_TAG, (tag) => pinTag(tag, folder));

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
 * A page with its release written in, for its code to read without asking the Worker, and with
 * its channel tag filled from it.
 * @param {string} page
 * @param {import("../shared/page/release.js").Release} release
 */
export const writeRelease = (page, release) =>
  page
    .replace(
      RELEASE_GUARD,
      () =>
        `<script type="application/json" id="release">${JSON.stringify(release).replaceAll("<", "\\u003c")}</script>\n  ${RELEASE_GUARD}`,
    )
    .replace(CHANNEL_TAG, () => renderChannelTag(release));

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
      if (!file.text?.includes(RELEASE_GUARD) || !guard)
        throw new Error(`The head of ${path} must load shared/release-guard.js.`);
      return [path, { ...file, text: pinPage(writeRelease(file.text, release), guard, folder) }];
    });
  return { ...files, ...Object.fromEntries(pinned) };
}
