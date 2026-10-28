// Takes a Contact report from a page behind the app's access gate and hands it to the email
// service. A POST must come from the page's own origin, so another site can't send reports with a
// signed-in phone's cookie, and the sender's address reaches the service only as a hash, which is
// enough to limit how often one sender writes.

import {
  CONTACT_CATEGORIES,
  CONTACT_LIMITS,
  validateContactFields,
  validateContactScreenshot,
} from "../page/contact-rules.js";
import { hideAddresses } from "../page/report-addresses.js";
import { hashTextInFull } from "./hash-text.js";
import { respondJson, respondMethodNotAllowed } from "./responses.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return parseContactSubmission(await readBoundedBody(request));
}

/** @param {any} body */
export function parseContactSubmission(body) {
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

/** @param {Request} request @param {any} env @param {string} app */
export async function serveContact(request, env, app) {
  if (request.method === "GET") {
    try {
      const config = await env.EMAIL.readContactConfig();
      return respondJson({ email: config.email });
    } catch {
      return respondJson({ email: null });
    }
  }
  if (request.method !== "POST") return respondMethodNotAllowed(["GET", "POST"]);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return respondJson({ problem: "origin" }, 403);
  if (!env.EMAIL) return respondJson({ problem: "unavailable" }, 503);
  let submission;
  try {
    submission = await readContactRequest(request);
  } catch {
    return respondJson({ problem: "invalid-request" }, 400);
  }
  try {
    const sender = await hashTextInFull(request.headers.get("cf-connecting-ip") ?? "unknown");
    return await env.EMAIL.submitContact({ app, submission, sender });
  } catch {
    return respondJson({ problem: "unavailable" }, 503);
  }
}
