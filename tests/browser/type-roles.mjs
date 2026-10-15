/**
 * Every piece of shown text off its app's type roles (shared/page/type.css), with what sets it and
 * why: a size that isn't one of the roles' sizes, a weight its font has no face for, which the
 * browser would fake from another, and Safari enlarging text on its own. A field's text is at
 * least 16px, which an iPhone doesn't zoom into on a tap. The tab bar's labels keep the phone's own
 * size, and text hidden for screen readers is left out.
 * @param {import("@playwright/test").Page} page
 */
export const listTextOffRoles = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const SMALLEST_FIELD_SIZE = 16;
    const TYPED_FIELDS =
      "select, textarea, input:not([type=checkbox], [type=radio], [type=hidden])";

    /** The size of each role the app sets, as the page draws it. */
    const readRoleSizes = () => {
      const names = new Set();
      for (const sheet of document.styleSheets)
        for (const rule of sheet.cssRules)
          if (rule instanceof CSSStyleRule && rule.selectorText.startsWith(":root"))
            for (const name of rule.style)
              if (/^--type-.+-size$/.test(name) && name !== "--type-field-size") names.add(name);
      const probe = document.createElement("span");
      document.body.append(probe);
      const sizes = [...names].map((name) => {
        probe.style.fontSize = `var(${name})`;
        return parseFloat(getComputedStyle(probe).fontSize);
      });
      probe.remove();
      return sizes;
    };

    /** @param {string} range a face's weight, like "300" or "100 900" @param {number} weight */
    const isInRange = (range, weight) => {
      const [lightest, heaviest = lightest] = range.split(" ").map(Number);
      return weight >= lightest && weight <= heaviest;
    };

    const faces = [...document.fonts].map((face) => ({
      family: face.family.replaceAll('"', ""),
      style: face.style,
      weight: face.weight,
    }));
    /** @param {string} family @param {string} style @param {number} weight */
    const describeFaceProblem = (family, style, weight) => {
      const familyFaces = faces.filter((face) => face.family === family && face.style === style);
      if (!familyFaces.length || familyFaces.some((face) => isInRange(face.weight, weight)))
        return "";
      return `no ${family} face at ${weight}`;
    };

    /** @param {Element} element */
    const isScreenReaderOnly = (element) => {
      const box = element.getBoundingClientRect();
      return box.width <= 1 || box.height <= 1;
    };

    /** A chart's text is drawn at its font size times the scale its SVG is shown at. @param {Element} element */
    const readDrawnScale = (element) =>
      element instanceof SVGGraphicsElement ? (element.getScreenCTM()?.a ?? 1) : 1;

    const roleSizes = readRoleSizes();
    /** @param {Element} element */
    const listProblems = (element) => {
      const style = getComputedStyle(element);
      const family = style.fontFamily.split(",")[0].replaceAll('"', "").trim();
      const size = parseFloat(style.fontSize) * readDrawnScale(element);
      const sizeAdjust = style.getPropertyValue("text-size-adjust");
      const isRoleSize = roleSizes.some((roleSize) => Math.abs(roleSize - size) < 0.01);
      return [
        isRoleSize ? "" : `size ${Math.round(size * 100) / 100}px off the roles`,
        describeFaceProblem(family, style.fontStyle, Number(style.fontWeight)),
        sizeAdjust === "100%" ? "" : `text-size-adjust ${sizeAdjust}`,
      ].filter(Boolean);
    };

    const offRoles = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim() || !element.checkVisibility()) continue;
      if (element.closest(".tab-label") || isScreenReaderOnly(element)) continue;
      const problems = listProblems(element);
      if (problems.length)
        offRoles.add(
          `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}: ${problems.join(", ")}`,
        );
    }
    for (const field of document.querySelectorAll(TYPED_FIELDS)) {
      const size = parseFloat(getComputedStyle(field).fontSize);
      if (field.checkVisibility() && size < SMALLEST_FIELD_SIZE)
        offRoles.add(
          `${field.tagName.toLowerCase()}.${field.getAttribute("class") ?? ""}: field at ${size}px, which an iPhone zooms into`,
        );
    }
    return [...offRoles];
  });

/**
 * A type role's size in pixels, as the page draws it, its weight, and its letter spacing in pixels,
 * 0 for a role that sets none, as numbers a test can step from, so a test checks a text against its
 * role rather than the role's value of the day.
 * @param {import("@playwright/test").Page} page
 * @param {string} role like "detail"
 */
export const readRole = (page, role) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.fontSize = `var(--type-${name}-size)`;
    probe.style.fontWeight = `var(--type-${name}-weight)`;
    probe.style.letterSpacing = `var(--type-${name}-tracking, 0px)`;
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const found = {
      size: parseFloat(style.fontSize),
      weight: Number(style.fontWeight),
      spacing: parseFloat(style.letterSpacing) || 0,
    };
    probe.remove();
    return found;
  }, role);

/**
 * How wide a field's face draws a line at the field's size, and the face it stands for at a role's
 * size, so a test can check that a field set at 16px still looks as big as the role it stands for.
 * @param {import("@playwright/test").Locator} field
 * @param {string} role a role's size token, like "--type-body-size"
 * @param {string} [face] the face the field stands for: the page's text, or its numbers' for years
 */
export const measureFieldFace = (field, role, face = "var(--text)") =>
  field.evaluate(
    async (element, [roleToken, roleFace]) => {
      const LINE = "Mets at Braves 2026";
      const style = getComputedStyle(element);
      /** @param {string} family @param {string} size */
      const measureLine = async (family, size) => {
        const probe = document.createElement("span");
        probe.textContent = LINE;
        probe.style.position = "absolute";
        probe.style.whiteSpace = "pre";
        probe.style.fontFamily = family;
        probe.style.fontSize = size;
        probe.style.fontWeight = style.fontWeight;
        document.body.append(probe);
        const probeStyle = getComputedStyle(probe);
        await document.fonts.load(
          `${probeStyle.fontWeight} ${probeStyle.fontSize} ${probeStyle.fontFamily}`,
          LINE,
        );
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return width;
      };
      return {
        field: await measureLine(style.fontFamily, style.fontSize),
        role: await measureLine(roleFace, `var(${roleToken})`),
      };
    },
    [role, face],
  );
