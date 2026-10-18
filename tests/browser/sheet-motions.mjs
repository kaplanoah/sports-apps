/**
 * Notes each motion the page gives a sheet, for the returned function to read and forget: each
 * script animation by its element's id, the part it moves (the sheet or its ::backdrop), and where
 * it ends, and each CSS animation by its element's id, part, and name. Call it before the page
 * loads.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<{ id: string, part: string, to?: object, name?: string }[]>>}
 */
export async function recordSheetMotions(page) {
  await page.addInitScript(() => {
    const motions = [];
    Object.assign(window, { sheetMotions: motions });
    const { prototype } = Element;
    const animate = prototype.animate;
    prototype.animate = function (keyframes, options) {
      if (Array.isArray(keyframes))
        motions.push({
          id: this.id,
          part: (typeof options === "object" && options.pseudoElement) || "sheet",
          to: keyframes.at(-1),
        });
      return animate.call(this, keyframes, options);
    };
    document.addEventListener("animationstart", (event) =>
      motions.push({
        id: /** @type {Element} */ (event.target).id,
        part: event.pseudoElement || "sheet",
        name: event.animationName,
      }),
    );
  });
  return () => page.evaluate(() => /** @type {any} */ (window).sheetMotions.splice(0));
}
