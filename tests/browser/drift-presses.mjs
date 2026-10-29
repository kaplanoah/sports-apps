import { openFromHomeScreen } from "./touch.mjs";
import { checkEachView } from "./view-walk.mjs";

// A finger that drifts on a control keeps the control's press until it drifts past press.js's
// distance, and no swipe of a sheet's, nor the page's pull to refresh, takes the touch before then,
// or iOS can drop the tap while the control still shows it pressed. The walk tries a control of
// each kind each view shows, in its top sheet or on the page, with the finger drifting a pixel at a
// time down, up and then down, and to each side, as TouchEvents, which a browser's own touches
// hold back within a slop of their own. A switch or a slider is left out, since a finger drags it
// from the moment it lands.

const PHONE = { width: 390, height: 844 };
// Past press.js's press settling, so the press shows before the finger drifts.
const SETTLE_MS = 100;
const DRIFT_STEPS = 16;
const PATHS = {
  down: Array.from({ length: DRIFT_STEPS }, (_, step) => ({ x: 0, y: step + 1 })),
  "up, then down": [
    ...Array.from({ length: 4 }, (_, step) => ({ x: 0, y: -(step + 1) })),
    ...Array.from({ length: DRIFT_STEPS + 4 }, (_, step) => ({ x: 0, y: step - 3 })),
  ],
  right: Array.from({ length: DRIFT_STEPS }, (_, step) => ({ x: step + 1, y: 0 })),
  left: Array.from({ length: DRIFT_STEPS }, (_, step) => ({ x: -(step + 1), y: 0 })),
};

/**
 * The middle of one control of each kind that shows its press in the top dialog, or on the page
 * when none is open, where a finger lands on it without scrolling, each marked so the drift finds
 * it.
 * @param {import("@playwright/test").Page} page
 */
const markControls = (page) =>
  page.evaluate(() => {
    for (const marked of document.querySelectorAll("[data-drift]"))
      marked.removeAttribute("data-drift");
    const top =
      document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("dialog[open]") ??
      document.body;
    const pressable = [
      "button:not([role='switch'], [role='slider'], [disabled])",
      "a[href]",
      "summary",
      "label:is(.appearance-choice, .contact-secondary)",
    ].join(", ");
    const kinds = new Set();
    const controls = [];
    for (const control of top.querySelectorAll(pressable)) {
      const box = control.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const isInView = y > 0 && y < innerHeight && x > 0 && x < innerWidth;
      const hit = isInView && document.elementFromPoint(x, y);
      if (!hit || !(control === hit || control.contains(hit) || hit.closest("label") === control))
        continue;
      const classes = [...control.classList].filter((name) => !name.includes("press"));
      const kind = [control.localName, ...classes].join(".");
      if (kinds.has(kind)) continue;
      kinds.add(kind);
      control.setAttribute("data-drift", String(controls.length));
      const words = control.textContent?.replace(/\s+/g, " ").trim().slice(0, 30);
      controls.push({ name: `${kind} (${words})`, x, y });
    }
    return controls;
  });

/**
 * Lands a finger on a control, as TouchEvents and pointer events, so its press starts.
 * @param {import("@playwright/test").Page} page
 * @param {number} index
 * @param {{ x: number, y: number }} at
 */
const landFinger = (page, index, at) =>
  page.evaluate(
    ({ index, at }) => {
      const control = /** @type {Element} */ (document.querySelector(`[data-drift="${index}"]`));
      const hit = document.elementFromPoint(at.x, at.y) ?? control;
      const point = { clientX: at.x, clientY: at.y };
      const touch = new Touch({ identifier: 1, target: hit, ...point });
      const pointer = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
      hit.dispatchEvent(
        new PointerEvent("pointerdown", { ...pointer, ...point, bubbles: true, cancelable: true }),
      );
      hit.dispatchEvent(
        new TouchEvent("touchstart", {
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { index, at },
  );

/**
 * Drifts the finger along `path` from where it landed, then lifts it as a scroll would, and says,
 * at each step, whether a swipe took the touch and whether the control still showed its press.
 * @param {import("@playwright/test").Page} page
 * @param {number} index
 * @param {{ x: number, y: number }} at
 * @param {{ x: number, y: number }[]} path
 */
const driftFinger = (page, index, at, path) =>
  page.evaluate(
    ({ index, at, path }) => {
      const control = /** @type {Element} */ (document.querySelector(`[data-drift="${index}"]`));
      const hit = document.elementFromPoint(at.x, at.y) ?? control;
      const pointer = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
      const steps = path.map((by) => {
        const point = { clientX: at.x + by.x, clientY: at.y + by.y };
        const touch = new Touch({ identifier: 1, target: hit, ...point });
        hit.dispatchEvent(
          new PointerEvent("pointermove", {
            ...pointer,
            ...point,
            bubbles: true,
            cancelable: true,
          }),
        );
        const move = new TouchEvent("touchmove", {
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        });
        hit.dispatchEvent(move);
        return {
          by,
          isTaken: move.defaultPrevented,
          isPressed: control.classList.contains("is-pressed"),
        };
      });
      const touch = new Touch({ identifier: 1, target: hit, clientX: at.x, clientY: at.y });
      hit.dispatchEvent(new PointerEvent("pointercancel", { ...pointer, bubbles: true }));
      hit.dispatchEvent(
        new TouchEvent("touchcancel", { changedTouches: [touch], bubbles: true, cancelable: true }),
      );
      return steps;
    },
    { index, at, path },
  );

/**
 * Every drift on the top dialog's controls where a swipe took the touch while the press showed.
 * @param {import("@playwright/test").Page} page
 */
async function listPressesLost(page) {
  const problems = [];
  const controls = await markControls(page);
  for (const [index, control] of controls.entries()) {
    for (const [pathName, path] of Object.entries(PATHS)) {
      await landFinger(page, index, control);
      await page.clock.runFor(SETTLE_MS);
      const steps = await driftFinger(page, index, control, path);
      await page.clock.runFor(SETTLE_MS);
      const lost = steps.find((step) => step.isTaken && step.isPressed);
      if (lost)
        problems.push(
          `${control.name}, ${pathName}: taken at ${lost.by.x},${lost.by.y} while pressed`,
        );
    }
  }
  return problems;
}

/**
 * Checks every view on a phone's Home Screen, where the page pulls to refresh, with
 * listPressesLost.
 * @param {import("@playwright/test").TestType<any, any>} test
 * @param {import("@playwright/test").Expect<{}>} expect
 * @param {{
 *   openWithEverything: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   viewGroups: Record<string, import("./view-walk.mjs").View[]>,
 * }} app
 */
export function testDriftPresses(test, expect, app) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  for (const [group, views] of Object.entries(app.viewGroups)) {
    test(`a drift on a control in ${group} keeps its press until a swipe takes the touch`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize(PHONE);
      await openFromHomeScreen(page);
      await app.openWithEverything(page);
      await checkEachView(page, views, async (view) => {
        expect(await listPressesLost(page), view.name).toEqual([]);
      });
    });
  }
}
