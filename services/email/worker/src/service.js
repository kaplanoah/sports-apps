import { isContactEmail } from "../../../../shared/page/contact-rules.js";
import {
  parseContactSubmission,
  respondContact,
} from "../../../../shared/worker/contact-request.js";

/** @param {any} env */
function isConfigured(env) {
  return (
    typeof env.CONTACT_MAIL_KEY === "string" &&
    !!env.CONTACT_MAIL_KEY.trim() &&
    isContactEmail(env.CONTACT_FROM) &&
    isContactEmail(env.CONTACT_TO) &&
    !!env.STORE
  );
}

/** @param {any} env */
export function createEmailService(env) {
  const findOutbox = () => env.STORE.get(env.STORE.idFromName("contact"));

  async function readHealth() {
    const release = env.VERSION?.tag ?? null;
    if (!isConfigured(env))
      return { ok: false, release, problem: "Contact mail is not configured" };
    try {
      const response = await findOutbox().fetch(new Request("https://email/status"));
      if (!response.ok) throw new Error("outbox-status");
      const status = await response.json();
      return status.ok === true
        ? { ok: true, release }
        : { ok: false, release, problem: "Contact delivery needs attention" };
    } catch {
      return { ok: false, release, problem: "its outbox doesn't answer" };
    }
  }

  function readContactConfig() {
    return { email: isConfigured(env) ? env.CONTACT_TO : null };
  }

  /** @param {{ app: string, submission: unknown, sender: string }} request */
  async function submitContact({ app, submission, sender }) {
    if (!isConfigured(env)) return respondContact({ problem: "unavailable" }, 503);
    let report;
    try {
      if (
        typeof app !== "string" ||
        typeof sender !== "string" ||
        !/^[a-z][a-z0-9-]{0,39}$/.test(app) ||
        !/^[a-f0-9]{64}$/.test(sender)
      )
        throw new Error("source");
      report = { ...parseContactSubmission(submission), app };
    } catch {
      return respondContact({ problem: "invalid-request" }, 400);
    }
    try {
      return await findOutbox().fetch(
        new Request("https://email/submit", {
          method: "POST",
          body: JSON.stringify({ submission: report, sender }),
        }),
      );
    } catch {
      return respondContact({ problem: "unavailable" }, 503);
    }
  }

  return { readHealth, readContactConfig, submitContact };
}
