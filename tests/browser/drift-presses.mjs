import { DRIFT_PX, GLIDE_REST_MS, TAPPABLE, TOUCH_SETTLE_MS } from "../../shared/page/press.js";
import { openFromHomeScreen } from "./touch.mjs";
import { checkEachView } from "./view-walk.mjs";

// A finger that drifts on a control keeps the control's press until it drifts past press.js's
// distance, and no swipe of a sheet's, nor the page's pull to refresh, takes the touch before then,
// or iOS can drop the tap while the control still shows it pressed. The walk lands on a control of
// each kind each view shows, in its top sheet or on the page, and tries each one press.js shows
// pressed, with the finger drifting a pixel at a time down, up and then down, and to each side, as
// TouchEvents, which a browser's own touches hold back within a slop of their own. A slider is left
// out, since a finger drags it from the moment it lands.

const PHONE = { width: 390, height: 844 };
const DRIFT_STEPS = DRIFT_PX + 6;
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
 * The middle of one control of each kind that takes a tap in the top dialog, or on the page when
 * none is open, where a finger lands on it without scrolling, each marked so the drift finds it.
 * @param {import("@playwright/test").Page} page
 */
const markControls = (page) =>
  page.evaluate((tappable) => {
    for (const marked of document.querySelectorAll("[data-drift]"))
      marked.removeAttribute("data-drift");
    const top =
      document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("dialog[open]") ??
      document.body;
    const kinds = new Set();
    const controls = [];
    for (const control of top.querySelectorAll(
      `:is(${tappable}):not([role='slider'], :disabled)`,
    )) {
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
  }, TAPPABLE);

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
 * Drifts the finger along `path` from where it landed, then lifts it as a scroll would, and says
 * whether the control showed its press before the finger moved and, at each step, whether a swipe
 * took the touch and whether the control still showed its press.
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
      const isPressedAtLanding = control.classList.contains("is-pressed");
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
      return { isPressedAtLanding, steps };
    },
    { index, at, path },
  );

/**
 * What went wrong in one drift: a step where a swipe took the touch while the press showed, or one
 * within press.js's distance where the press let go.
 * @param {{ by: { x: number, y: number }, isTaken: boolean, isPressed: boolean }[]} steps
 */
function listDriftProblems(steps) {
  const problems = [];
  for (const { by, isTaken, isPressed } of steps) {
    const at = `${by.x},${by.y}`;
    if (isTaken && isPressed) problems.push(`taken at ${at} while pressed`);
    else if (!isPressed && Math.hypot(by.x, by.y) <= DRIFT_PX)
      problems.push(`press let go at ${at}`);
  }
  return problems;
}

/**
 * Lands a finger on a control, waits for its press to show, and drifts it along `path`.
 * @param {import("@playwright/test").Page} page
 * @param {number} index
 * @param {{ x: number, y: number }} at
 * @param {{ x: number, y: number }[]} path
 */
async function pressAndDrift(page, index, at, path) {
  await landFinger(page, index, at);
  await page.clock.runFor(TOUCH_SETTLE_MS);
  const drift = await driftFinger(page, index, at, path);
  // So the next finger lands on a page at rest rather than stopping a glide.
  await page.clock.runFor(GLIDE_REST_MS);
  return drift;
}

/**
 * Every drift on the top dialog's pressed controls that lost its press or its tap, and a view
 * with no control that shows its press.
 * @param {import("@playwright/test").Page} page
 */
async function listPressesLost(page) {
  const problems = [];
  let pressedCount = 0;
  const controls = await markControls(page);
  for (const [index, control] of controls.entries()) {
    const { isPressedAtLanding: isPressable } = await pressAndDrift(page, index, control, []);
    if (!isPressable) continue;
    pressedCount++;
    for (const [pathName, path] of Object.entries(PATHS)) {
      const { isPressedAtLanding, steps } = await pressAndDrift(page, index, control, path);
      const drift = isPressedAtLanding ? listDriftProblems(steps) : ["no press on landing"];
      problems.push(...drift.map((problem) => `${control.name}, ${pathName}: ${problem}`));
    }
  }
  if (pressedCount === 0) problems.push("no control showed its press");
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
