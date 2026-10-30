// What the Worker's JSON endpoints answer with.
import { SECURITY_HEADERS } from "../page/security-headers.js";

export const respondJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": SECURITY_HEADERS["x-content-type-options"],
    },
  });

export const respondError = (status, code, message) =>
  respondJson({ error: { code, message } }, status);

/** @param {string[]} methods the only methods the path answers */
export function respondMethodNotAllowed(methods) {
  const response = respondError(405, "method_not_allowed", `${methods.join(" or ")} only.`);
  response.headers.set("allow", methods.join(", "));
  return response;
}

export const describeError = (error) => (error instanceof Error ? error.message : String(error));
