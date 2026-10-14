// The service worker keeps its last steps: each start, install, activation, and push, and each
// page it opened and how (offline-worker.js), so Diagnostics can show what it did on a phone,
// where nothing else records a load the worker never let reach the page. It runs before any page
// can ask it anything, so it keeps the lines itself, in a cache of its own, which the page reads
// at the same address (service-worker.js).

const STEPS_CACHE = "service-worker-steps";
const KEPT_STEPS = 60;

const nameStepsAddress = () => `${self.registration.scope}service-worker-steps`;

/** @param {Cache} cache */
async function readSteps(cache) {
  const kept = await cache.match(nameStepsAddress());
  const steps = kept ? await kept.json() : [];
  return Array.isArray(steps) ? steps : [];
}

/** @param {string} text */
async function appendStep(text) {
  const cache = await caches.open(STEPS_CACHE);
  const steps = [...(await readSteps(cache)), { at: Date.now(), text }].slice(-KEPT_STEPS);
  await cache.put(
    nameStepsAddress(),
    new Response(JSON.stringify(steps), { headers: { "content-type": "application/json" } }),
  );
}

/** @type {Promise<void>} */
let writing = Promise.resolve();

// One write at a time, so two steps at once don't drop each other. A step a phone's storage won't
// take is lost, and the worker goes on as if it were kept.
/**
 * Keeps a step the worker took, for Diagnostics.
 * @param {string} text
 * @returns {Promise<void>}
 */
function noteWorkerStep(text) {
  writing = writing.then(() => appendStep(text)).catch(() => {});
  return writing;
}

// A DOMException isn't an Error in every WebKit, so what failed is read from its message.
/** @param {unknown} error */
const describeFailure = (error) =>
  typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error);

noteWorkerStep("Started");
self.addEventListener("install", (event) => event.waitUntil(noteWorkerStep("Installed")));
self.addEventListener("activate", (event) => event.waitUntil(noteWorkerStep("Activated")));
self.addEventListener("push", (event) => event.waitUntil(noteWorkerStep("Push received")));
