// A short, fixed-length name for any text, like a story's or a photo's address, for keys the store
// limits in length.

/**
 * The first 16 hex digits of the text's SHA-256.
 * @param {string} text
 */
export async function hashText(text) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return [...digest.subarray(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
