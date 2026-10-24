import { buildDiagnosticsReport } from "./diagnostics.js";
import { createContactDraftStore, prepareContactSubmission } from "./contact-drafts.js";
import {
  CONTACT_CATEGORIES,
  validateContactFields,
  validateContactScreenshot,
} from "./contact-rules.js";
import { renderContact } from "./contact-view.js";
import { setHtml } from "./html.js";
import { openSheet, wireSheet } from "./sheet.js";
import { closeSheet } from "./sheet-swipe.js";
import { keepDialogFor } from "./sheet-memory.js";

/* global START_AFTER_AWAY_MS -- from long-away.js */

/** @param {File} file */
function readScreenshot(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        type: file.type,
        filename: file.name,
        content: String(reader.result).split(",")[1],
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** @param {HTMLDialogElement} dialog */
export function startContact(dialog) {
  const store = createContactDraftStore();
  const ready = store.restore().catch(() => {});
  let screenshotRead = Promise.resolve();
  const body = dialog.querySelector(".settings-body");
  const view = {
    screen: "menu",
    category: "bug",
    receiptEmail: "",
    email: null,
    sending: false,
    validation: null,
  };
  const readDraft = () => store.read(view.category);
  const findField = (name) =>
    /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (
      dialog.querySelector(`#contact${name}`)
    );

  function drawContact() {
    const draft = readDraft();
    setHtml(body, renderContact({ ...view, draft }));
    if (view.screen === "form") {
      findField("Message").value = draft.message;
      findField("Email").value = draft.email;
      const include = /** @type {HTMLInputElement | null} */ (findField("Include"));
      if (include) include.checked = draft.includeDiagnostics;
      for (const name of ["Message", "Email"]) {
        const field = findField(name);
        const isInvalid = view.validation?.field === name.toLowerCase();
        field.setAttribute("aria-invalid", String(isInvalid));
        const description = [
          name === "Email" && "contactEmailHint",
          isInvalid && "contactValidation",
        ]
          .filter(Boolean)
          .join(" ");
        if (description) field.setAttribute("aria-describedby", description);
        else field.removeAttribute("aria-describedby");
      }
    }
    const back = /** @type {HTMLButtonElement | null} */ (dialog.querySelector(".contact-back"));
    if (back) back.disabled = view.sending;
  }

  function focusTitle() {
    const title = /** @type {HTMLElement} */ (dialog.querySelector("h2"));
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }

  /** @param {string} category */
  function showCategory(category) {
    if (!CONTACT_CATEGORIES.some(({ key }) => key === category)) return;
    view.category = category;
    view.screen = "form";
    view.validation = null;
    const draft = readDraft();
    if (category === "bug" && draft.diagnostics === null)
      draft.diagnostics = buildDiagnosticsReport();
    drawContact();
    focusTitle();
  }

  async function readContactAddress() {
    try {
      const response = await fetch("contact", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return;
      const result = await response.json();
      view.email = result.email;
      if (view.screen === "menu") drawContact();
    } catch {
      // An offline draft remains usable without the standalone email link.
    }
  }

  async function openContact() {
    await ready;
    if (!view.sending) view.screen = "menu";
    drawContact();
    openSheet(dialog);
    focusTitle();
    readContactAddress();
  }

  function saveFields() {
    if (view.screen !== "form" || view.sending) return;
    const draft = readDraft();
    draft.message = findField("Message").value;
    draft.email = findField("Email").value;
    findField("Message").textContent = draft.message;
    findField("Email").setAttribute("value", draft.email);
    const include = /** @type {HTMLInputElement | null} */ (findField("Include"));
    if (include) {
      draft.includeDiagnostics = include.checked;
      include.toggleAttribute("checked", include.checked);
    }
    store.save(view.category);
  }

  /** @param {{ field: string, text: string }} validation */
  function showValidation(validation) {
    view.validation = validation;
    drawContact();
    if (validation.field === "screenshot") {
      /** @type {HTMLElement} */ (dialog.querySelector('[data-contact="attach"]')).focus();
      return;
    }
    findField(
      validation.field === "message"
        ? "Message"
        : validation.field === "email"
          ? "Email"
          : "Screenshot",
    )?.focus();
  }

  /** @param {Event} event */
  async function loadScreenshot(event) {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.id !== "contactScreenshot" || view.sending) return;
    const file = input.files?.[0];
    if (!file) return;
    const problem = validateContactScreenshot(file);
    if (problem) return showValidation({ field: "screenshot", text: problem });
    const category = view.category;
    try {
      const screenshot = await readScreenshot(file);
      store.read(category).screenshot = screenshot;
      await store.save(category);
      if (view.category === category) drawContact();
    } catch {
      showValidation({
        field: "screenshot",
        text: "Couldn't read the screenshot. Choose it again.",
      });
    }
  }

  /** @param {Event} event */
  function followContactClick(event) {
    const button = /** @type {HTMLElement | null} */ (
      /** @type {Element} */ (event.target).closest("[data-contact]")
    );
    if (!button || view.sending) return;
    saveFields();
    const action = button.dataset.contact;
    if (action === "category") showCategory(button.dataset.category);
    else if (action === "attach") findField("Screenshot").click();
    else if (action === "remove") {
      readDraft().screenshot = null;
      store.save(view.category);
      drawContact();
      /** @type {HTMLElement} */ (dialog.querySelector('[data-contact="attach"]')).focus();
    } else if (action === "diagnostics") {
      readDraft().diagnosticsOpen = !readDraft().diagnosticsOpen;
      store.save(view.category);
      drawContact();
    } else if (action === "done" || (action === "back" && view.screen === "menu")) {
      closeSheet(dialog);
      document.getElementById("contactBtn").focus();
    } else if (action === "back") {
      view.screen = "menu";
      drawContact();
      focusTitle();
    }
  }

  /** @param {Event} event */
  async function submitContact(event) {
    event.preventDefault();
    if (view.sending) return;
    saveFields();
    const draft = readDraft();
    const validation = validateContactFields(draft);
    if (validation) return showValidation(validation);
    const category = view.category;
    view.sending = true;
    view.validation = null;
    await screenshotRead;
    const request = prepareContactSubmission(category, draft);
    await store.save(category);
    drawContact();
    try {
      const response = await fetch("contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(20000),
      });
      const receipt = response.ok && (await response.json());
      if (!receipt?.accepted || receipt.id !== request.id) throw new Error("unconfirmed");
      view.receiptEmail = request.email;
      await store.clear(category);
      view.screen = "received";
    } catch {
      draft.failed = true;
      await store.save(category);
    } finally {
      view.sending = false;
      drawContact();
      if (view.screen === "received") focusTitle();
      else /** @type {HTMLElement} */ (dialog.querySelector('[type="submit"]')).focus();
    }
  }

  dialog.addEventListener("input", saveFields);
  dialog.addEventListener("change", (event) => {
    if (/** @type {HTMLElement} */ (event.target).id === "contactScreenshot")
      screenshotRead = loadScreenshot(event);
  });
  dialog.addEventListener("click", followContactClick);
  dialog.addEventListener("submit", submitContact);
  dialog.addEventListener(
    "cancel",
    (event) => {
      if (view.sending) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  dialog.addEventListener(
    "click",
    (event) => {
      if (view.sending && event.target === dialog) event.stopImmediatePropagation();
    },
    { capture: true },
  );
  document.getElementById("contactBtn").addEventListener("click", openContact);
  wireSheet(dialog, {
    name: "Contact",
    isOwnGesture: () => view.sending,
    keeper: {
      read: () => ({ ...view, sending: false }),
      reopen: (saved) => {
        Object.assign(view, saved, { sending: false });
        ready.then(drawContact);
        return true;
      },
    },
  });
  keepDialogFor(dialog, START_AFTER_AWAY_MS);
}
