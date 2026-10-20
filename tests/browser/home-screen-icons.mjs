import { readFileSync } from "node:fs";

/**
 * An icon as the page's own stylesheet draws it, with the image in it rather than a file to fetch,
 * as worker/page-files.mjs builds it.
 * @param {URL} pageFolder the app's page/ folder
 * @param {string} file
 */
export const drawIcon = (pageFolder, file) =>
  `url("data:image/png;base64,${readFileSync(new URL(file, pageFolder)).toString("base64")}")`;
