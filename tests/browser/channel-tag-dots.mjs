import { expect } from "@playwright/test";
import { THEMES, showTheme } from "./theme-layout.mjs";
import { SCREENS } from "./themes.mjs";

/** @param {import("@playwright/test").Page} page */
async function readTagLayout(page) {
  return page.locator("#channelTag").evaluate(async (tag) => {
    await document.fonts.ready;
    /** @param {Element} element */
    const readBox = (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const style = getComputedStyle(tag);
    return {
      tag: readBox(tag),
      title: readBox(document.querySelector("header.top h1")),
      facts: [...tag.querySelectorAll(".fact")].map(readBox),
      advances: [...tag.querySelectorAll(".sep")].map((separator) => {
        const separatorStyle = getComputedStyle(separator);
        return {
          width: readBox(separator).width,
          left: separatorStyle.marginLeft,
          right: separatorStyle.marginRight,
        };
      }),
      type: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight],
      padding: style.padding,
    };
  });
}

/** @param {import("@playwright/test").Page} page */
async function readDots(page) {
  return page.locator("#channelTag .sep").evaluateAll((separators) =>
    separators.map((separator) => {
      const baselineProbe = document.createElement("span");
      baselineProbe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      const xHeightProbe = document.createElement("span");
      xHeightProbe.style.cssText = "display:inline-block;width:0;height:0.5ex";
      separator.after(baselineProbe, xHeightProbe);
      const baseline = baselineProbe.getBoundingClientRect().bottom;
      const halfXHeight = xHeightProbe.getBoundingClientRect().height;
      const style = getComputedStyle(separator);
      const dot = getComputedStyle(separator, "::after");
      const dotCenter =
        separator.getBoundingClientRect().bottom -
        parseFloat(dot.bottom) -
        parseFloat(dot.height) / 2 +
        new DOMMatrix(dot.transform).m42;
      baselineProbe.remove();
      xHeightProbe.remove();
      return {
        diameter: [parseFloat(dot.width), parseFloat(dot.height)],
        offset: baseline - dotCenter,
        halfXHeight,
        opacity: style.opacity,
        glyph: style.visibility,
        dot: dot.visibility,
        content: dot.content,
        fill: dot.backgroundColor,
        ink: style.color,
        radius: dot.borderRadius,
      };
    }),
  );
}

/**
 * Checks the dots against the native bullet renderer, including the entire WNBA badge's pixels.
 * @param {import("@playwright/test").Page} page
 * @param {"mlb" | "wnba"} app
 */
async function checkShownChannelTagDots(page, app) {
  const layout = await readTagLayout(page);
  const dots = await readDots(page);
  expect(dots).toHaveLength(2);
  for (const dot of dots) {
    expect(dot.opacity).toBe("0.7");
    if (app === "mlb") {
      expect(dot.diameter).toEqual([3, 3]);
      expect(Math.abs(dot.offset - dot.halfXHeight)).toBeLessThan(0.02);
      expect(dot.glyph).toBe("hidden");
      expect(dot.dot).toBe("visible");
      expect(dot.content).toBe('""');
      expect(dot.fill).toBe(dot.ink);
      expect(dot.radius).toBe("50%");
    } else {
      expect(dot.glyph).toBe("visible");
      expect(dot.content).toBe("none");
    }
  }
  expect(layout.advances.map(({ left, right }) => [left, right])).toEqual([
    ["4px", "4px"],
    ["4px", "4px"],
  ]);
  const tag = page.locator("#channelTag");
  const painted = app === "wnba" ? await tag.screenshot() : null;
  const native = await page.addStyleTag({
    content:
      ".channel-tag .sep { display:inline; position:static; text-box:normal; visibility:visible } .channel-tag .sep::after { content:none }",
  });
  expect(await readTagLayout(page)).toEqual(layout);
  if (app === "wnba") expect(await tag.screenshot()).toEqual(painted);
  await native.evaluate((style) => style.parentNode.removeChild(style));
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {"mlb" | "wnba"} app
 */
export async function checkChannelTagDots(page, app) {
  for (const viewport of Object.values(SCREENS)) {
    await page.setViewportSize(viewport);
    for (const theme of THEMES) {
      await showTheme(page, theme);
      await checkShownChannelTagDots(page, app);
    }
  }
}
