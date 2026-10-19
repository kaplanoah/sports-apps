// The events iOS sends for a touch, sent by hand, since no CI browser sends a click after a touch
// it took for a scroll, as iOS sometimes does.

/**
 * Clicks an element, as iOS can after a finger left it, and says whether the click went through.
 * @param {import("@playwright/test").Locator} target
 */
export const sendClick = (target) =>
  target.evaluate((element) =>
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
  );

/**
 * Sends a finger's pointer on an element as the browser does: down at its middle, each move down
 * the screen by `moves`, then up, or cancelled once the browser takes the touch for a scroll, and
 * the touch's end, a lift or, as iOS ends some, a cancel.
 * @param {import("@playwright/test").Locator} target
 * @param {{ moves: number[], isCancelled?: boolean, isTouchCancelled?: boolean }} finger
 */
export const sendFinger = (target, { moves, isCancelled = false, isTouchCancelled = false }) =>
  target.evaluate(
    (element, finger) => {
      const box = element.getBoundingClientRect();
      /**
       * @param {string} type
       * @param {number} down
       */
      const send = (type, down) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: "touch",
            isPrimary: true,
            clientX: box.left + box.width / 2,
            clientY: box.top + box.height / 2 + down,
          }),
        );
      send("pointerdown", 0);
      for (const down of finger.moves) send("pointermove", down);
      send(finger.isCancelled ? "pointercancel" : "pointerup", finger.moves.at(-1) ?? 0);
      const end = finger.isTouchCancelled ? "touchcancel" : "touchend";
      element.dispatchEvent(new TouchEvent(end, { bubbles: true }));
    },
    { moves, isCancelled, isTouchCancelled },
  );

/**
 * Sends one of a second finger's pointer events on an element, as the browser does while the first
 * finger is down.
 * @param {import("@playwright/test").Locator} target
 * @param {"pointerdown" | "pointercancel"} type
 */
export const sendSecondFinger = (target, type) =>
  target.evaluate(
    (element, eventType) =>
      element.dispatchEvent(
        new PointerEvent(eventType, { bubbles: true, pointerType: "touch", isPrimary: false }),
      ),
    type,
  );

/**
 * Holds the page's clock still, so a click sent after a finger comes as soon after its lift as
 * iOS sends it, however slow the machine.
 * @param {import("@playwright/test").Page} page
 */
export const holdClock = async (page) =>
  page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
