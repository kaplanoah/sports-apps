import { CONTACT_CATEGORIES } from "../../../../shared/page/contact-rules.js";

/** @param {any} submission @param {any} env */
export function buildContactMail(submission, env) {
  const category = CONTACT_CATEGORIES.find(({ key }) => key === submission.category).name;
  return {
    from: env.CONTACT_FROM,
    to: [env.CONTACT_TO],
    ...(submission.email && { reply_to: submission.email }),
    subject: `${submission.app.toUpperCase()}: ${category}`,
    text: [
      `${submission.app.toUpperCase()}: ${category}`,
      `Report: ${submission.id}`,
      submission.email ? `Reply email: ${submission.email}` : "No reply email was provided",
      submission.message,
      submission.diagnostics,
    ]
      .filter(Boolean)
      .join("\n\n"),
    ...(submission.screenshot && {
      attachments: [
        {
          filename: submission.screenshot.filename,
          content: submission.screenshot.content,
          content_type: submission.screenshot.type,
        },
      ],
    }),
  };
}

/** @param {any} env @param {string} path @param {RequestInit} options @param {typeof fetch} fetchImpl */
async function requestContactMail(env, path, options, fetchImpl) {
  return fetchImpl(`https://api.resend.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${env.CONTACT_MAIL_KEY}`,
      "content-type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
}

/** @param {any} submission @param {any} env @param {typeof fetch} fetchImpl */
export async function sendContactMail(submission, env, fetchImpl) {
  const response = await requestContactMail(
    env,
    "/emails",
    {
      method: "POST",
      headers: { "idempotency-key": `contact/${submission.app}/${submission.id}` },
      body: JSON.stringify(buildContactMail(submission, env)),
    },
    fetchImpl,
  );
  if (!response.ok) throw new Error("mail-unavailable");
  const result = await response.json();
  if (typeof result.id !== "string" || !result.id) throw new Error("mail-response");
  return result.id;
}

/** @param {string} id @param {any} env @param {typeof fetch} fetchImpl */
export async function readContactDelivery(id, env, fetchImpl) {
  const response = await requestContactMail(
    env,
    `/emails/${encodeURIComponent(id)}`,
    { method: "GET" },
    fetchImpl,
  );
  if (!response.ok) throw new Error("mail-status-unavailable");
  const result = await response.json();
  return result.last_event;
}
