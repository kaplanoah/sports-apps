// An email is kept only as a keyed hash, so the store can tell an address already in use without
// holding it, and nobody holding the store can find it without the key.

/** @param {string} email */
const normalizeEmail = (email) => email.trim().normalize("NFC").toLowerCase();

/**
 * @param {string} email
 * @param {string} key the EMAIL_KEY secret
 */
export async function hashEmail(email, key) {
  const encoder = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(normalizeEmail(email)),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
