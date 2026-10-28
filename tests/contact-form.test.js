import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_CATEGORIES,
  CONTACT_LIMITS,
  validateContactFields,
  validateContactScreenshot,
} from "../shared/page/contact-rules.js";
import { createContactDraft, prepareContactSubmission } from "../shared/page/contact-drafts.js";
import { renderContact } from "../shared/page/contact-view.js";

test("all categories use their selected labels, stacked fields and exact email explanation", () => {
  const categories = [
    { key: "bug", name: "Bug report", label: "What happened, and what did you expect to happen?" },
    { key: "feature", name: "Feature request", label: "What would make the app better?" },
    { key: "other", name: "Something else", label: "Message" },
  ];
  assert.deepEqual(CONTACT_CATEGORIES, categories);
  for (const category of categories) {
    const markup = String(
      renderContact({ screen: "form", category: category.key, draft: createContactDraft() }),
    );
    assert.ok(markup.includes(category.label));
    assert.ok(
      markup.indexOf('for="contactEmail"') <
        markup.indexOf("An email address is needed if you'd like a reply"),
    );
    assert.ok(
      markup.indexOf("An email address is needed if you'd like a reply") <
        markup.indexOf('id="contactEmail"'),
    );
    assert.match(markup, /placeholder="name@example.com"/);
    assert.doesNotMatch(markup, /<textarea[^>]*placeholder=/);
    assert.equal(markup.includes('id="contactInclude"'), category.key === "bug");
    assert.doesNotMatch(markup, /App details|example build/);
  }
});

test("menu uses only the selected category labels and never invents a domain address", () => {
  const markup = String(renderContact({ screen: "menu", email: null }));
  for (const { name } of CONTACT_CATEGORIES) assert.ok(markup.includes(name));
  assert.doesNotMatch(markup, /mailto:|your-domain|description/);
  const configured = String(renderContact({ screen: "menu", email: "owner@example.com" }));
  assert.match(configured, /mailto:owner@example.com/);
  assert.match(configured, /Or email directly at <a[^>]+>owner@example.com<\/a>/);
});

test("optional email, required message, bounds and safe screenshot formats", () => {
  assert.equal(validateContactFields({ message: "A request", email: "" }), null);
  for (const email of ["bad", "a@example.com\r\nBcc:b@example.com", "a@b", "a b@example.com"])
    assert.equal(validateContactFields({ message: "A request", email }).field, "email");
  assert.equal(validateContactFields({ message: "  ", email: "" }).field, "message");
  assert.equal(
    validateContactFields({ message: "x".repeat(CONTACT_LIMITS.message + 1), email: "" }).field,
    "message",
  );
  assert.ok(validateContactScreenshot({ type: "image/svg+xml", size: 50 }));
  assert.ok(validateContactScreenshot({ type: "image/png", size: CONTACT_LIMITS.screenshot + 1 }));
  assert.equal(validateContactScreenshot({ type: "image/png", size: 50 }), null);
});

test("diagnostics opt-out is complete; a retry keeps its identifier and exact report", () => {
  const draft = createContactDraft();
  draft.message = "The score stays still";
  draft.diagnostics = "Actual report";
  const first = prepareContactSubmission("bug", draft);
  assert.equal(first.diagnostics, "Actual report");
  draft.failed = true;
  draft.diagnosticsOpen = true;
  assert.deepEqual(prepareContactSubmission("bug", draft), first);
  draft.includeDiagnostics = false;
  const optedOut = prepareContactSubmission("bug", draft);
  assert.ok(!Object.hasOwn(optedOut, "diagnostics"));
  assert.equal(prepareContactSubmission("bug", draft).id, optedOut.id);
  for (const category of ["feature", "other"])
    assert.ok(!Object.hasOwn(prepareContactSubmission(category, draft), "diagnostics"));
});

test("drafts start independently, keep screenshots and identify an edited message as a separate submission", () => {
  const bug = createContactDraft();
  const feature = createContactDraft();
  bug.message = "A bug";
  bug.email = "fan@example.com";
  bug.screenshot = { type: "image/png", content: "aGVsbG8=", filename: "phone.png" };
  bug.includeDiagnostics = false;
  const before = prepareContactSubmission("bug", bug);
  assert.equal(feature.message, "");
  assert.equal(feature.includeDiagnostics, true);
  assert.equal(before.screenshot, bug.screenshot);
  bug.message = "An edited bug";
  assert.notEqual(prepareContactSubmission("bug", bug).id, before.id);
});

test("failure and both confirmations keep the approved copy and escape visitor text", () => {
  const draft = { ...createContactDraft(), failed: true };
  const failed = String(renderContact({ screen: "form", category: "bug", draft }));
  assert.match(failed, /Couldn't confirm your message was sent/);
  assert.match(failed, /Your draft is saved\. Try again\./);
  assert.match(failed, />Try again<\/button>/);
  const noEmail = String(renderContact({ screen: "received", receiptEmail: "" }));
  assert.match(noEmail, /<h3>Message sent<\/h3>/);
  assert.match(
    noEmail,
    /<p>Since you didn&#39;t include your email address, we won&#39;t be able to reply<\/p>/,
  );
  const email = String(renderContact({ screen: "received", receiptEmail: "<script>" }));
  assert.match(email, /<p>Replies will go to &lt;script&gt;<\/p>/);
  assert.equal(email.includes("<script>"), false);
});
