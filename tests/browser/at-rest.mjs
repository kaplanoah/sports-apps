import { drag } from "./touch.mjs";
import { expect } from "@playwright/test";

/**
 * Keeps each "ResizeObserver loop" error the page reports from then on, which a browser raises
 * when an observer's callback resizes what an observer watches, and returns a way to read them.
 * Each names the observers that last ran before it, by where the page made them and what they
 * watch, so a failure says which one looped. It also keeps each observer's run, with the sizes it
 * heard, so a count of frames can say which observers ran while it counted.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<string[]>>}
 */
export async function listResizeLoops(page) {
  await page.addInitScript(() => {
    const RECENT_CALLBACKS = 6;
    /** @type {string[]} */
    const resizeLoops = [];
    /** @type {string[]} */
    const recentCallbacks = [];
    /** @type {string[]} */
    const observerRuns = [];
    Object.assign(window, { resizeLoops, observerRuns });
    /** @param {Element} target */
    const nameTarget = (target) =>
      target.id ? `#${target.id}` : [target.localName, ...target.classList].join(".");
    const PageResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends PageResizeObserver {
      /** @param {ResizeObserverCallback} callback */
      constructor(callback) {
        const pageFrames = (new Error().stack ?? "")
          .split("\n")
          .filter((line) => line.includes("http"));
        const madeAt = pageFrames[0]?.trim() ?? "somewhere";
        super((entries, observer) => {
          const targets = entries.map((entry) => nameTarget(entry.target)).join(", ");
          const sizes = entries
            .map(({ target, contentRect }) => {
              return `${nameTarget(target)} ${contentRect.width}x${contentRect.height}`;
            })
            .join(", ");
          observerRuns.push(`${madeAt} on ${sizes}`);
          recentCallbacks.push(`${madeAt} on ${targets}`);
          recentCallbacks.splice(0, recentCallbacks.length - RECENT_CALLBACKS);
          callback(entries, observer);
        });
      }
    };
    // The list reports each loop, so WebKit doesn't also raise it as an uncaught error.
    addEventListener("error", (event) => {
      if (!event.message.includes("ResizeObserver loop")) return;
      event.preventDefault();
      resizeLoops.push(`${event.message} After: ${recentCallbacks.join(" | ")}`);
    });
  });
  return () => page.evaluate(() => /** @type {any} */ (window).resizeLoops);
}

/**
 * Empties the list of ResizeObserver loops, so it counts only from here on.
 * @param {import("@playwright/test").Page} page
 */
export const forgetResizeLoops = (page) =>
  page.evaluate(() => {
    /** @type {any} */ (window).resizeLoops.length = 0;
  });

// A whole season's page can take longer than an expectation's usual wait to load in CI's WebKit,
// which draws without the phone's GPU; once loaded, the page must be at rest as quickly as any.
const LOAD_TIMEOUT_MS = 15_000;

/**
 * Waits for the browser's next rendering update, in which each ResizeObserver hears what changed
 * size since the last one, the page's own before this one, which it makes last. The tests' clock
 * fakes the page's animation frames, so nothing else makes a busy browser run one: CI's WebKit
 * can go seconds without, and a count of frames that starts then would count the page catching up
 * on a change it made long before.
 * @param {import("@playwright/test").Page} page
 */
const waitForRenderingUpdate = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const observer = new ResizeObserver(() => {
          observer.disconnect();
          resolve(undefined);
        });
        observer.observe(document.documentElement);
      }),
  );

/**
 * Where the page asked for each frame across `durationMs` of its clock, once it has caught up, by
 * the first line of the page's own code that asked, with how many times, so a failure says what
 * kept asking, and what else happened meanwhile, which a failure names too: how far the page's
 * clock moved, which also moves as real time passes, what changed, and which observers ran.
 * @param {import("@playwright/test").Page} page
 * @param {number} durationMs
 * @returns {Promise<{ requests: [string, number][], notes: string[] }>}
 */
async function readFrameRequestsAcross(page, durationMs) {
  await waitForRenderingUpdate(page);
  await page.evaluate(() => {
    const MOST_CHANGES_NAMED = 6;
    const counted = /** @type {any} */ (window);
    counted.pageRequestFrame ??= window.requestAnimationFrame;
    /** @type {Map<string, number>} */
    const requests = new Map();
    counted.frameRequests = requests;
    counted.countStartedAt = Date.now();
    if (counted.observerRuns) counted.observerRuns.length = 0;
    /** @type {Set<string>} */
    const changed = new Set();
    counted.changedElements = changed;
    counted.changeWatcher?.disconnect();
    counted.changeWatcher = new MutationObserver((records) => {
      for (const { target } of records) {
        const element = target instanceof Element ? target : target.parentElement;
        if (!element || changed.size >= MOST_CHANGES_NAMED) continue;
        changed.add(
          element.id ? `#${element.id}` : [element.localName, ...element.classList].join("."),
        );
      }
    });
    counted.changeWatcher.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    window.requestAnimationFrame = (callback) => {
      const pageFrames = (new Error().stack ?? "")
        .split("\n")
        .filter((line) => line.includes("http"));
      const askedAt = pageFrames[0]?.trim() ?? "somewhere";
      requests.set(askedAt, (requests.get(askedAt) ?? 0) + 1);
      return counted.pageRequestFrame(callback);
    };
  });
  await page.clock.runFor(durationMs);
  return page.evaluate(() => {
    const counted = /** @type {any} */ (window);
    counted.changeWatcher.disconnect();
    const notes = [
      `the page's clock moved ${Date.now() - counted.countStartedAt}ms`,
      `changed: ${[...counted.changedElements].join(", ") || "nothing"}`,
      ...(counted.observerRuns ?? []).map((/** @type {string} */ run) => `observer ${run}`),
    ];
    return { requests: [...counted.frameRequests], notes };
  });
}

/**
 * Lists where the page asked for each frame across `durationMs` of its clock, with how many
 * times, and, when it asked for any, what else happened meanwhile.
 * @param {import("@playwright/test").Page} page
 * @param {number} durationMs
 * @returns {Promise<string[]>}
 */
async function listFrameRequestsAcross(page, durationMs) {
  const { requests, notes } = await readFrameRequestsAcross(page, durationMs);
  const asked = requests.map(([askedAt, count]) => `${count} from ${askedAt}`);
  return asked.length ? [...asked, ...notes] : [];
}

/**
 * Counts the frames the page asks for across `durationMs` of its clock.
 * @param {import("@playwright/test").Page} page
 * @param {number} durationMs
 */
export async function countFramesAcross(page, durationMs) {
  const { requests } = await readFrameRequestsAcross(page, durationMs);
  return requests.reduce((total, [, count]) => total + count, 0);
}

/**
 * Waits until `read` gives an empty list. A wait that times out says what the page last gave, or
 * that it never answered, as when its main thread is busy, which a poll's own timeout leaves as
 * only a timeout.
 * @param {() => Promise<string[]>} read
 * @param {string} kept what each item in the list says the page kept doing
 * @param {number} [timeout]
 */
async function waitForNone(read, kept, timeout) {
  /** @type {string[] | null} */
  let last = null;
  try {
    await expect.poll(async () => (last = await read()), { timeout }).toEqual([]);
  } catch (error) {
    const said = last ? `The page kept ${kept}: ${last.join("; ")}` : "The page never answered";
    throw new Error(said, { cause: error });
  }
}

/**
 * Waits for a second of the page's clock without a frame asked for.
 * @param {import("@playwright/test").Page} page
 */
const waitForNoFrameRequests = (page) =>
  waitForNone(() => listFrameRequestsAcross(page, 1000), "asking for frames", LOAD_TIMEOUT_MS);

/**
 * Waits for the page's store to read every document it watches once, which it marks by keeping
 * when the page was current. A change saved before then can be what the page's first reads find.
 * @param {import("@playwright/test").Page} page
 */
export const waitForFirstCatchUp = (page) =>
  expect
    .poll(() => page.evaluate(() => localStorage.getItem("syncedAt")), {
      timeout: LOAD_TIMEOUT_MS,
    })
    .not.toBeNull();

/**
 * Waits for the page to finish drawing what it loaded. Its first drawing ends the load note, its
 * store then reads every document it watches again to catch up, and each drawing can lay the page
 * out again a frame later. A page quiet while its reads are on their way, or between those frames,
 * isn't done loading.
 * @param {import("@playwright/test").Page} page
 */
export async function waitForLoadToSettle(page) {
  await expect(page.locator("#loadNote")).toHaveCount(0, { timeout: LOAD_TIMEOUT_MS });
  await waitForFirstCatchUp(page);
  await waitForNoFrameRequests(page);
}

/**
 * Expects the page to be at rest: no animation left on it, and nothing asking for a frame across
 * a second of its clock.
 * @param {import("@playwright/test").Page} page
 */
export async function expectAtRest(page) {
  await waitForNone(() => listAnimations(page), "animating");
  expect(await listFrameRequestsAcross(page, 1000)).toEqual([]);
  expect(await listAnimations(page)).toEqual([]);
}

/**
 * Each animation on the page, by what it animates and the element it moves, so a page that
 * never comes to rest names what kept moving.
 * @param {import("@playwright/test").Page} page
 */
const listAnimations = (page) =>
  page.evaluate(() =>
    document.getAnimations().map((animation) => {
      const effect = /** @type {KeyframeEffect | null} */ (animation.effect);
      const target = effect?.target;
      const element = target ? [target.localName, ...target.classList].join(".") : "nothing";
      const name =
        Reflect.get(animation, "animationName") ||
        Reflect.get(animation, "transitionProperty") ||
        [...new Set(effect?.getKeyframes().flatMap((frame) => Object.keys(frame)))]
          .filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key))
          .join(" ");
      return `${name} on ${element}${target?.id ? `#${target.id}` : ""}`;
    }),
  );

/**
 * Swipes the lists under `from` on to the next one: with a finger in Chromium, and in WebKit,
 * which Playwright gives no touches or wheel to move on a phone, as a smooth scroll of the lists
 * between a touch's start and its end once they move, as a finger's flick.
 * @param {import("@playwright/test").Page} page
 * @param {string} browserName
 * @param {{ x: number, y: number }} from
 */
export async function swipeToNextList(page, browserName, from) {
  if (browserName === "chromium") {
    const lift = await drag(page, from, { x: -300 });
    await lift();
    return;
  }
  await page.evaluate(({ x, y }) => {
    const pages = document.elementFromPoint(x, y)?.closest(".pager-pages");
    if (!pages) return;
    pages.dispatchEvent(new Event("touchstart"));
    const lift = () => pages.dispatchEvent(new Event("touchend"));
    pages.addEventListener("scroll", lift, { once: true });
    pages.scrollBy({ left: pages.clientWidth, behavior: "smooth" });
  }, from);
}
