import {
  CONTACT_CATEGORIES,
  CONTACT_LIMITS,
  isContactEmail,
  validateContactFields,
  validateContactScreenshot,
} from "../page/contact-rules.js";
import { hideAddresses } from "../page/step-log.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {any} env */
export const isContactConfigured = (env) =>
  !!env.CONTACT_MAIL_KEY &&
  isContactEmail(env.CONTACT_FROM) &&
  isContactEmail(env.CONTACT_TO) &&
  !!env.CONTACT;

/** @param {unknown} value */
export async function hashContactValue(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {Uint8Array} bytes @param {string} type */
function isScreenshotSignature(bytes, type) {
  if (type === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const readAscii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  return type === "image/webp" && readAscii(0, 4) === "RIFF" && readAscii(8, 12) === "WEBP";
}

/** @param {any} screenshot */
function readScreenshot(screenshot) {
  if (screenshot === null) return null;
  if (
    !screenshot ||
    typeof screenshot.content !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(screenshot.content)
  )
    throw new Error("screenshot");
  const bytes = Uint8Array.from(atob(screenshot.content), (letter) => letter.charCodeAt(0));
  if (
    validateContactScreenshot({ type: screenshot.type, size: bytes.length }) ||
    !isScreenshotSignature(bytes, screenshot.type)
  )
    throw new Error("screenshot");
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
    screenshot.type
  ];
  return {
    type: screenshot.type,
    filename: `screenshot.${extension}`,
    content: screenshot.content,
  };
}

/** @param {Request} request */
async function readBoundedBody(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("content-type");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CONTACT_LIMITS.request) {
      await reader.cancel();
      throw new Error("size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** @param {Request} request */
export async function readContactRequest(request) {
  const body = await readBoundedBody(request);
  if (!UUID.test(body?.id) || !CONTACT_CATEGORIES.some(({ key }) => key === body.category))
    throw new Error("request");
  if (
    typeof body.message !== "string" ||
    typeof body.email !== "string" ||
    validateContactFields(body)
  )
    throw new Error("fields");
  if (
    body.diagnostics !== undefined &&
    (body.category !== "bug" ||
      typeof body.diagnostics !== "string" ||
      body.diagnostics.length > CONTACT_LIMITS.diagnostics)
  )
    throw new Error("diagnostics");
  return {
    id: body.id,
    category: body.category,
    message: body.message.trim(),
    email: body.email.trim(),
    ...(body.diagnostics !== undefined && { diagnostics: hideAddresses(body.diagnostics) }),
    screenshot: readScreenshot(body.screenshot),
  };
}

/** @param {unknown} body @param {number} [status] */
export const respondContact = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });

/** @param {Request} request @param {any} env */
export async function serveContact(request, env) {
  if (request.method === "GET")
    return respondContact({ email: isContactConfigured(env) ? env.CONTACT_TO : null });
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return respondContact({ problem: "origin" }, 403);
  if (!isContactConfigured(env)) return respondContact({ problem: "unavailable" }, 503);
  let submission;
  try {
    submission = await readContactRequest(request);
  } catch {
    return respondContact({ problem: "invalid-request" }, 400);
  }
  try {
    const sender = await hashContactValue(request.headers.get("cf-connecting-ip") ?? "unknown");
    const stub = env.CONTACT.get(env.CONTACT.idFromName("outbox"));
    return await stub.fetch(
      new Request("https://contact/submit", {
        method: "POST",
        body: JSON.stringify({ submission, sender }),
      }),
    );
  } catch {
    return respondContact({ problem: "unavailable" }, 503);
  }
}
