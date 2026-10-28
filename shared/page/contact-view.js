import { html } from "./html.js";
import { CONTACT_CATEGORIES, CONTACT_LIMITS } from "./contact-rules.js";

import { SETTINGS_BACK, SETTINGS_CARET } from "./settings-icons.js";

// Phosphor's paperclip, at its Light weight.
const PAPERCLIP = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208.25,123.76a6,6,0,0,1,0,8.49l-82.06,82a54,54,0,0,1-76.36-76.39L149.1,37.14a38,38,0,1,1,53.77,53.72L103.59,191.54a22,22,0,1,1-31.15-31.09l83.28-84.67a6,6,0,0,1,8.56,8.42L81,168.91a10,10,0,1,0,14.11,14.18L194.35,82.4a26,26,0,1,0-36.74-36.8L58.33,146.28a42,42,0,1,0,59.37,59.44l82.06-82A6,6,0,0,1,208.25,123.76Z"/></svg>`;

/** @param {string} title @param {string} back */
const renderHeader = (title, back) => html`<div class="sheet-top"><div class="sheet-head">
  <button type="button" class="settings-back" data-contact="back" aria-label="Back to ${back}">${SETTINGS_BACK}</button>
  <div class="sheet-title"><h2 id="contactTitle">${title}</h2></div>
</div></div>`;

/** @param {import("./contact-drafts.js").ContactDraft} draft */
function renderScreenshot(draft) {
  return html`<div class="contact-attachment-area">
    <input id="contactScreenshot" class="contact-file" type="file" accept="image/png,image/jpeg,image/webp" />
    <label for="contactScreenshot" class="contact-secondary">${PAPERCLIP}${draft.screenshot ? "Change screenshot" : "Add screenshot"}</label>
    ${draft.screenshot && html`<div class="contact-attachment"><img src="${draft.screenshot.preview}" alt="Attached screenshot" /><span>${draft.screenshot.filename}</span><button type="button" class="contact-quiet" data-contact="remove">Remove</button></div>`}
  </div>`;
}

/** @param {import("./contact-drafts.js").ContactDraft} draft */
function renderDiagnostics(draft) {
  return html`<div class="contact-diagnostics">
    <div class="contact-diagnostics-controls"><label><input id="contactInclude" type="checkbox" ${draft.includeDiagnostics ? "checked" : ""} />Include diagnostics</label>
    <button type="button" class="contact-quiet" data-contact="diagnostics" aria-expanded="${draft.diagnosticsOpen}" aria-controls="contactReport">${draft.diagnosticsOpen ? "Hide diagnostics" : "View diagnostics"}</button></div>
    <pre id="contactReport" ${draft.diagnosticsOpen ? "" : "hidden"} tabindex="0">${draft.diagnosticsOpen ? draft.diagnostics : ""}</pre>
  </div>`;
}

/** @param {any} view */
export function renderContact(view) {
  if (view.screen === "received")
    return html`${renderHeader("Contact", "Settings")}<div class="contact-success" role="status"><h3>Message sent</h3><p>${view.receiptEmail ? `Replies will go to ${view.receiptEmail}` : "Since you didn't include your email address, we won't be able to reply"}</p><button type="button" class="contact-primary" data-contact="done">Done</button></div>`;
  if (view.screen === "menu")
    return html`${renderHeader("Contact", "Settings")}<div class="contact-menu">${CONTACT_CATEGORIES.map(({ key, name }) => html`<button type="button" class="settings-page-row press-tint" data-contact="category" data-category="${key}">${name}${SETTINGS_CARET}</button>`)}</div>
      ${view.email && html`<p class="contact-domain">Or email directly at <a href="mailto:${view.email}">${view.email}</a></p>`}`;
  const category = CONTACT_CATEGORIES.find(({ key }) => key === view.category);
  const draft = view.draft;
  return html`${renderHeader(category.name, "Contact")}
    <form id="contactForm" novalidate aria-busy="${view.sending}"><fieldset ${view.sending ? "disabled" : ""}>
      <div class="contact-field"><label for="contactMessage">${category.label}</label><textarea id="contactMessage" required maxlength="${CONTACT_LIMITS.message}">${draft.message}</textarea></div>
      ${renderScreenshot(draft)}
      <div class="contact-field"><label for="contactEmail">Email (optional)</label><p class="contact-note" id="contactEmailHint">An email address is needed if you'd like a reply</p><input id="contactEmail" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="name@example.com" value="${draft.email}" aria-describedby="contactEmailHint" /></div>
      ${view.category === "bug" && renderDiagnostics(draft)}
      <p class="contact-validation" id="contactValidation" role="alert" ${view.validation ? "" : "hidden"}>${view.validation?.text}</p>
      ${draft.failed && html`<div class="contact-failure" role="alert"><strong>Couldn't confirm your message was sent</strong><p>Your draft is saved. Try again.</p></div>`}
      <button type="submit" class="contact-primary">${view.sending && html`<span class="contact-spinner" aria-hidden="true"></span>`}${view.sending ? "Sending\u2026" : draft.failed ? "Try again" : "Send"}</button>
    </fieldset></form>`;
}
