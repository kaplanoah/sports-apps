// Security settings shared by HTTP responses, deployment checks and offline documents.
export const TRANSPORT_SECURITY = "max-age=31536000";

export const SECURITY_HEADERS = Object.freeze({
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

export const REQUIRED_CSP_DIRECTIVES = Object.freeze({
  scripts: "script-src 'self'",
  frames: "frame-ancestors 'none'",
});

export const OFFLINE_HEADER_NAMES = Object.freeze([
  "content-type",
  "content-security-policy",
  ...Object.keys(SECURITY_HEADERS),
]);
