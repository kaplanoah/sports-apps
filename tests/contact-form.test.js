import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_CATEGORIES,
  CONTACT_LIMITS,
  fitContactDiagnostics,
  validateContactFields,
  validateContactScreenshot,
} from "../shared/page/contact-rules.js";
import {
  createContactDraft,
  isContactRetry,
  prepareContactSubmission,
} from "../shared/page/contact-drafts.js";
import { renderContact } from "../shared/page/contact-view.js";

test("each form labels its message for its category, with the email's note between its label and field", () => {
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
  }
});

test("the menu names each category and links an email address only when the Worker has one", () => {
  const markup = String(renderContact({ screen: "menu", email: null }));
  for (const { name } of CONTACT_CATEGORIES) assert.ok(markup.includes(name));
  assert.doesNotMatch(markup, /mailto:/);
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

test("a report too long to send keeps its header and each log's title and newest lines, losing the largest log's oldest", () => {
  const writeLog = (title, count) =>
    [title, ...Array.from({ length: count }, (_, age) => `${title} ${age} ${"x".repeat(90)}`)].join(
      "\n",
    );
  const header = "Release 1.2.3\nDevice: iPhone";
  const largeCount = CONTACT_LIMITS.diagnostics / 100 + 50;
  const report = [
    header,
    writeLog("Record", 3),
    writeLog("Sheets", largeCount),
    writeLog("Day strip", 40),
    writeLog("Phone look", 5),
  ].join("\n\n");
  const fitted = fitContactDiagnostics(report);
  assert.ok(fitted.length <= CONTACT_LIMITS.diagnostics);
  const blocks = fitted.split("\n\n");
  assert.equal(blocks[0], header);
  assert.equal(blocks[1], writeLog("Record", 3));
  assert.ok(blocks[2].startsWith(writeLog("Sheets", 500)));
  assert.ok(!fitted.includes(`Sheets ${largeCount - 1} `));
  assert.equal(blocks[3], writeLog("Day strip", 40));
  assert.equal(blocks[4], writeLog("Phone look", 5));
  assert.equal(fitContactDiagnostics("short\nreport"), "short\nreport");
});

test("the form draws a screenshot's preview, never what's sent, and its report only while shown, so the page's saved copy stays small", () => {
  const draft = createContactDraft();
  draft.screenshot = {
    type: "image/png",
    content: "c2VudA==",
    filename: "phone.png",
    preview: "data:image/jpeg;base64,c21hbGw=",
  };
  draft.diagnostics = "Actual report";
  const drawForm = () => String(renderContact({ screen: "form", category: "bug", draft }));
  const hidden = drawForm();
  assert.match(hidden, /<img src="data:image\/jpeg;base64,c21hbGw="/);
  assert.doesNotMatch(hidden, /c2VudA==/);
  assert.doesNotMatch(hidden, /Actual report/);
  draft.diagnosticsOpen = true;
  assert.match(drawForm(), />Actual report<\/pre>/);
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
  assert.ok(isContactRetry("bug", draft));
  draft.message = "The score stays still in the ninth";
  assert.ok(!isContactRetry("bug", draft));
  for (const category of ["feature", "other"])
    assert.ok(!Object.hasOwn(prepareContactSubmission(category, draft), "diagnostics"));
});

test("drafts start independently, keep screenshots and identify an edited message as a separate submission", () => {
  const bug = createContactDraft();
  const feature = createContactDraft();
  bug.message = "A bug";
  bug.email = "fan@example.com";
  const sent = { type: "image/png", content: "aGVsbG8=", filename: "phone.png" };
  bug.screenshot = { ...sent, preview: "data:image/jpeg;base64,c21hbGw=" };
  bug.includeDiagnostics = false;
  const before = prepareContactSubmission("bug", bug);
  assert.equal(feature.message, "");
  assert.equal(feature.includeDiagnostics, true);
  assert.deepEqual(before.screenshot, sent);
  bug.message = "An edited bug";
  assert.notEqual(prepareContactSubmission("bug", bug).id, before.id);
});

test("a failed send and both confirmations say what happened and escape what the visitor typed", () => {
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
