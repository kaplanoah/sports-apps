import { CONTACT_CATEGORIES } from "./contact-rules.js";

/** @typedef {{ type: string, filename: string, content: string }} ContactScreenshot */
/** @typedef {{ message: string, email: string, includeDiagnostics: boolean, diagnostics: string | null, diagnosticsOpen: boolean, screenshot: ContactScreenshot | null, attempt: any, failed: boolean }} ContactDraft */

/** @returns {ContactDraft} */
export const createContactDraft = () => ({
  message: "",
  email: "",
  includeDiagnostics: true,
  diagnostics: null,
  diagnosticsOpen: false,
  screenshot: null,
  attempt: null,
  failed: false,
});

/** @param {string} category @param {ContactDraft} draft */
export function prepareContactSubmission(category, draft) {
  const fields = {
    category,
    message: draft.message,
    email: draft.email.trim(),
    screenshot: draft.screenshot,
    ...(category === "bug" && draft.includeDiagnostics && { diagnostics: draft.diagnostics }),
  };
  const previous = draft.attempt;
  if (previous && JSON.stringify(previous.fields) === JSON.stringify(fields))
    return previous.request;
  const request = { id: crypto.randomUUID(), ...fields };
  draft.attempt = { fields, request };
  return request;
}

function openDraftDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("contact", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createContactDraftStore() {
  /** @type {Map<string, ContactDraft>} */
  const drafts = new Map(CONTACT_CATEGORIES.map(({ key }) => [key, createContactDraft()]));
  /** @type {Promise<IDBDatabase | null>} */
  const database = openDraftDatabase().catch(() => null);
  let writes = Promise.resolve();
  const savedScreenshots = new Map();
  const savedAttempts = new Map();

  /** @param {string} category */
  const read = (category) => drafts.get(category);

  async function restore() {
    const db = await database;
    if (!db) return;
    await Promise.all(
      CONTACT_CATEGORIES.map(
        ({ key }) =>
          new Promise((resolve) => {
            const transaction = db.transaction("drafts");
            const records = transaction.objectStore("drafts");
            const request = records.get(key);
            const screenshot = records.get(`${key}:screenshot`);
            const attempt = records.get(`${key}:attempt`);
            transaction.oncomplete = () => {
              if (request.result)
                drafts.set(key, {
                  ...createContactDraft(),
                  ...request.result,
                  screenshot: screenshot.result ?? null,
                  attempt: attempt.result ?? null,
                });
              savedScreenshots.set(key, read(key).screenshot);
              savedAttempts.set(key, read(key).attempt);
              resolve(null);
            };
            transaction.onabort = transaction.onerror = () => resolve(null);
          }),
      ),
    );
  }

  /** @param {string} category */
  function save(category) {
    const { screenshot, attempt, ...value } = read(category);
    writes = writes
      .then(async () => {
        const db = await database;
        if (!db) return;
        await new Promise((resolve) => {
          const transaction = db.transaction("drafts", "readwrite");
          const records = transaction.objectStore("drafts");
          records.put(value, category);
          if (savedScreenshots.get(category) !== screenshot)
            records.put(screenshot, `${category}:screenshot`);
          if (savedAttempts.get(category) !== attempt) records.put(attempt, `${category}:attempt`);
          transaction.oncomplete = () => {
            savedScreenshots.set(category, screenshot);
            savedAttempts.set(category, attempt);
            resolve(null);
          };
          transaction.onabort = transaction.onerror = () => resolve(null);
        });
      })
      .catch(() => {});
    return writes;
  }

  /** @param {string} category */
  async function clear(category) {
    drafts.set(category, createContactDraft());
    await save(category);
  }

  return { read, restore, save, clear };
}
