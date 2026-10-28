import { expect } from "@playwright/test";
import { INSET_SHADOW_PATTERN } from "./press-looks.mjs";
import { waitForPressesToEnd } from "./tap-states.mjs";

/**
 * Waits until no row is pressed and no color is mid-transition, so a press a test's own tap left
 * behind, or a tint still fading, is never measured as the page's colors. A test of a pressed or
 * hovered row's colors waits for this before it presses or hovers, then measures that state.
 * @param {import("@playwright/test").Page} page
 */
export async function waitForSettledColors(page) {
  await waitForPressesToEnd(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !document
            .getAnimations()
            .some(
              (animation) =>
                animation instanceof CSSTransition && animation.playState === "running",
            ),
      ),
    )
    .toBe(true);
}

/**
 * Every piece of shown text that stands out from what's behind it by less than WCAG's AA level
 * asks: 4.5 to 1, or 3 to 1 for large text, 24px and up or 18.66px and up at 700. The text's color
 * fades by its own alpha and by each opacity around it, and the background is the first one behind
 * it that fills, with any see-through ones and inset tints over it laid on top. Text over a
 * picture, a gradient, or a layer drawn behind it can't be measured this way and is left out, as
 * are disabled controls and marks with no letter or digit, like a separator or a dash, which WCAG
 * leaves out, and text hidden for screen readers. It measures the page as it shows at once, a
 * pressed row's tint and all, so a test of a pressed or hovered row's colors measures that state.
 * @param {import("@playwright/test").Page} page
 */
export const listLowContrastTextAsShown = (page) =>
  page.evaluate(async (insetShadowPattern) => {
    await document.fonts.ready;
    const SMALL_TEXT_CONTRAST = 4.5;
    const LARGE_TEXT_CONTRAST = 3;
    const LARGE_SIZE = 24;
    const LARGE_BOLD_SIZE = 18.66;
    const BOLD_WEIGHT = 700;
    const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d", { willReadFrequently: true })
    );
    /**
     * A CSS color as red, green, and blue from 0 to 255 and alpha from 0 to 1, whatever space the
     * browser gives it in.
     * @param {string} color
     */
    const readRgba = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      return { rgb: [red, green, blue], alpha: alpha / 255 };
    };

    /**
     * @param {number[]} top
     * @param {number[]} bottom
     * @param {number} alpha
     */
    const layOver = (top, bottom, alpha) =>
      top.map((channel, index) => channel * alpha + bottom[index] * (1 - alpha));

    /** @param {number[]} rgb */
    const measureLuminance = (rgb) => {
      const [red, green, blue] = rgb.map((channel) => {
        const share = channel / 255;
        return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };

    /** @param {number[]} first @param {number[]} second */
    const measureContrast = (first, second) => {
      const [light, dark] = [measureLuminance(first), measureLuminance(second)].sort(
        (a, b) => b - a,
      );
      return (light + 0.05) / (dark + 0.05);
    };

    /** @param {CSSStyleDeclaration} style */
    const isPainted = (style) =>
      style.backgroundImage !== "none" || readRgba(style.backgroundColor).alpha > 0;

    /** @param {Element} element */
    const hasLayerBehind = (element) =>
      ["::before", "::after"].some((pseudo) => {
        const style = getComputedStyle(element, pseudo);
        return style.content !== "none" && style.zIndex === "-1" && isPainted(style);
      });

    /**
     * The tint an inset shadow lays over an element's whole fill, as a press does a row's, or null
     * where none does, as where one only rings its edge.
     * @param {Element} element
     * @param {CSSStyleDeclaration} style
     */
    const readInsetTint = (element, style) => {
      const [, color, spread] = style.boxShadow.match(new RegExp(insetShadowPattern)) ?? [];
      const { width, height } = element.getBoundingClientRect();
      return color && Number(spread) * 2 >= Math.min(width, height) ? readRgba(color) : null;
    };

    const pageBackground = readRgba(getComputedStyle(document.body).backgroundColor).rgb;

    /** @type {Map<Element, number[] | null>} */
    const backgrounds = new Map();
    /**
     * What's behind an element's text, or null where it can't be measured.
     * @param {Element | null} element
     * @returns {number[] | null}
     */
    const readBackground = (element) => {
      if (!element) return pageBackground;
      if (backgrounds.has(element))
        return /** @type {number[] | null} */ (backgrounds.get(element));
      const style = getComputedStyle(element);
      const fill = readRgba(style.backgroundColor);
      /** @type {number[] | null} */
      let background;
      if (style.backgroundImage !== "none" || hasLayerBehind(element)) background = null;
      else if (fill.alpha === 1) background = fill.rgb;
      else {
        const below = readBackground(element.parentElement);
        background = below && layOver(fill.rgb, below, fill.alpha);
      }
      const tint = readInsetTint(element, style);
      if (background && tint) background = layOver(tint.rgb, background, tint.alpha);
      backgrounds.set(element, background);
      return background;
    };

    /** @type {Map<Element, number>} */
    const opacities = new Map();
    /**
     * @param {Element | null} element
     * @returns {number}
     */
    const readOpacity = (element) => {
      if (!element) return 1;
      if (!opacities.has(element))
        opacities.set(
          element,
          Number(getComputedStyle(element).opacity) * readOpacity(element.parentElement),
        );
      return /** @type {number} */ (opacities.get(element));
    };

    /** @param {Element} element */
    const readTextColor = (element) => {
      const style = getComputedStyle(element);
      return readRgba(element instanceof SVGElement ? style.fill : style.color);
    };

    /** @param {Element} element */
    const isLargeText = (element) => {
      const style = getComputedStyle(element);
      const size = parseFloat(style.fontSize);
      return (
        size >= LARGE_SIZE || (size >= LARGE_BOLD_SIZE && Number(style.fontWeight) >= BOLD_WEIGHT)
      );
    };

    /** @param {Element} element */
    const isScreenReaderOnly = (element) => {
      const box = element.getBoundingClientRect();
      return box.width <= 1 || box.height <= 1;
    };

    /** @param {Text} node */
    const isMeasured = (node) => {
      const element = node.parentElement;
      return Boolean(
        element &&
        LETTER_OR_DIGIT.test(node.textContent ?? "") &&
        element.checkVisibility() &&
        !isScreenReaderOnly(element) &&
        !element.closest(":disabled"),
      );
    };

    const lowContrast = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!isMeasured(/** @type {Text} */ (node))) continue;
      const element = /** @type {Element} */ (node.parentElement);
      const background = readBackground(element);
      if (!background) continue;
      const text = readTextColor(element);
      const shown = layOver(text.rgb, background, text.alpha * readOpacity(element));
      const contrast = measureContrast(shown, background);
      const needed = isLargeText(element) ? LARGE_TEXT_CONTRAST : SMALL_TEXT_CONTRAST;
      if (contrast < needed)
        lowContrast.add(
          `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""} "${node.textContent?.trim().slice(0, 24)}": ${contrast.toFixed(2)} to 1, under ${needed}`,
        );
    }
    return [...lowContrast];
  }, INSET_SHADOW_PATTERN);

/**
 * The text listLowContrastTextAsShown names once the page's colors have settled.
 * @param {import("@playwright/test").Page} page
 */
export async function listLowContrastText(page) {
  await waitForSettledColors(page);
  return listLowContrastTextAsShown(page);
}
