import { readFileSync } from "node:fs";

/**
 * @param {string} type
 * @param {Buffer} bytes
 */
const writeDataUrl = (type, bytes) => `data:${type};base64,${bytes.toString("base64")}`;

/**
 * @param {URL} pageFolder
 * @param {string} file
 */
const readDataUrl = (pageFolder, file) =>
  writeDataUrl(
    file.endsWith(".svg") ? "image/svg+xml" : "image/png",
    readFileSync(new URL(file, pageFolder)),
  );

/**
 * An icon as the page's own stylesheet draws it, with the image in it rather than a file to fetch,
 * as worker/page-files.mjs builds it.
 * @param {URL} pageFolder the app's page/ folder
 * @param {string} file
 */
export const drawIcon = (pageFolder, file) => `url("${readDataUrl(pageFolder, file)}")`;

// A PNG's width sits in its header, right after its signature and the header's length and name.
/**
 * @param {URL} pageFolder
 * @param {string} file
 */
const readPngWidth = (pageFolder, file) => readFileSync(new URL(file, pageFolder)).readUInt32BE(16);

/**
 * An SVG drawn as the Home Screen's PNGs are, filling a square page `size` pixels wide.
 * @param {import("@playwright/test").Page} page
 * @param {string} svgUrl
 * @param {number} size
 */
async function screenshotSvg(page, svgUrl, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html, body { margin: 0 } img { display: block; width: ${size}px; height: ${size}px }</style><img src="${svgUrl}" />`,
  );
  await page.locator("img").evaluate((image) => /** @type {HTMLImageElement} */ (image).decode());
  const shot = await page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    scale: "css",
  });
  return writeDataUrl("image/png", shot);
}

/** @typedef {{ x: number, y: number, radius: number }} Ball */

/**
 * How far one picture's pixels sit from another's, each `size` pixels wide: the mean of how far
 * each channel is off, out of 255, and the share of channels more than `allowance` off. With two
 * SVGs for `redrawnUrls`, the second picture is System's icon, drawn from the light and the dark
 * SVG with the wood split down the middle and `ball` fading from the light look's on the left to
 * the dark's on the right.
 * @param {{ committedUrl: string, redrawnUrls: string[], size: number, allowance: number, ball?: Ball }} pictures
 */
async function comparePictures({ committedUrl, redrawnUrls, size, allowance, ball }) {
  /** @param {string} source */
  async function readPixels(source) {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = new OffscreenCanvas(size, size);
    const context = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext("2d"));
    context.drawImage(image, 0, 0, size, size);
    return context.getImageData(0, 0, size, size);
  }

  /**
   * @param {ImageData} light
   * @param {ImageData} dark
   * @param {(x: number, y: number) => number} shareOfDark
   */
  function blendPixels(light, dark, shareOfDark) {
    const out = new ImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const share = shareOfDark(x + 0.5, y + 0.5);
        const at = (y * size + x) * 4;
        for (let channel = 0; channel < 4; channel++) {
          out.data[at + channel] = Math.round(
            light.data[at + channel] * (1 - share) + dark.data[at + channel] * share,
          );
        }
      }
    }
    return out;
  }

  /** @param {number} value */
  const clamp = (value) => Math.min(1, Math.max(0, value));

  /**
   * @param {ImageData} light
   * @param {ImageData} dark
   * @param {Ball} ball
   */
  function drawSystemIcon(light, dark, { x, y, radius }) {
    const canvas = new OffscreenCanvas(size, size);
    const context = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext("2d"));
    context.putImageData(
      blendPixels(light, dark, (left) => (left < size / 2 ? 0 : 1)),
      0,
      0,
    );
    const faded = new OffscreenCanvas(size, size);
    const fadedContext = /** @type {OffscreenCanvasRenderingContext2D} */ (faded.getContext("2d"));
    fadedContext.putImageData(
      blendPixels(light, dark, (left) => clamp((left - (x - radius)) / (2 * radius))),
      0,
      0,
    );
    context.save();
    context.beginPath();
    context.arc(x, y, radius, 0, 2 * Math.PI);
    context.clip();
    context.drawImage(faded, 0, 0);
    context.restore();
    return context.getImageData(0, 0, size, size);
  }

  /** @param {string[]} sources */
  async function readRedrawn(sources) {
    if (sources.length === 1) return readPixels(sources[0]);
    const [light, dark] = await Promise.all(sources.map(readPixels));
    return drawSystemIcon(light, dark, /** @type {Ball} */ (ball));
  }

  const committed = await readPixels(committedUrl);
  const redrawn = await readRedrawn(redrawnUrls);
  let total = 0;
  let off = 0;
  for (let at = 0; at < committed.data.length; at++) {
    const difference = Math.abs(committed.data[at] - redrawn.data[at]);
    total += difference;
    if (difference > allowance) off++;
  }
  return { mean: total / committed.data.length, offShare: off / committed.data.length };
}

/**
 * How far a committed Home Screen icon's pixels sit from the same icon drawn again, from one SVG
 * as the PNGs are drawn, or from two as System's is, with its ball where the app's icon has it.
 * @param {import("@playwright/test").Page} page
 * @param {URL} pageFolder the app's page/ folder
 * @param {{ committed: string, svgs: string[], allowance: number, ball?: Ball }} icon
 */
export async function measureIconRedraw(page, pageFolder, { committed, svgs, allowance, ball }) {
  const size = readPngWidth(pageFolder, committed);
  const svgUrls = svgs.map((svg) => readDataUrl(pageFolder, svg));
  const redrawnUrls =
    svgUrls.length === 1 ? [await screenshotSvg(page, svgUrls[0], size)] : svgUrls;
  return page.evaluate(comparePictures, {
    committedUrl: readDataUrl(pageFolder, committed),
    redrawnUrls,
    size,
    allowance,
    ball,
  });
}
