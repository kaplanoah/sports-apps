import test from "node:test";
import assert from "node:assert/strict";
import { buildContactMail, sendContactMail } from "../worker/src/mail.js";

const ID = "23428fa1-9250-4f13-b567-c094f8bdc448";
const SUBMISSION = {
  id: ID,
  category: "bug",
  message: "The score stays still",
  email: "fan@example.com",
  screenshot: null,
};
const ENV = {
  CONTACT_FROM: "reports@example.com",
  CONTACT_TO: "owner@example.com",
  CONTACT_MAIL_KEY: "test-mail-key",
};

test("delivery uses an authenticated sender, visitor Reply-To, plain text and a provider idempotency key", async () => {
  const submission = {
    ...SUBMISSION,
    app: "wnba",
    diagnostics: "Actual diagnostics",
    screenshot: { filename: "screenshot.png", type: "image/png", content: "iVBORw0KGgo=" },
  };
  const mail = buildContactMail(submission, ENV);
  assert.equal(mail.from, ENV.CONTACT_FROM);
  assert.deepEqual(mail.to, [ENV.CONTACT_TO]);
  assert.equal(mail.reply_to, SUBMISSION.email);
  assert.match(mail.text, /Actual diagnostics/);
  assert.equal(mail.attachments[0].content_type, "image/png");
  assert.ok(!Object.hasOwn(mail, "html"));
  assert.ok(!Object.hasOwn(buildContactMail({ ...submission, email: "" }, ENV), "reply_to"));
  const id = await sendContactMail(submission, ENV, async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers["idempotency-key"], `contact/wnba/${ID}`);
    assert.equal(options.headers.authorization, "Bearer test-mail-key");
    assert.deepEqual(JSON.parse(options.body), mail);
    return Response.json({ id: "provider-id" });
  });
  assert.equal(id, "provider-id");
});
