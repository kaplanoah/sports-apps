// The SHA-256 of any text, in full, or as a short, fixed-length name, like a story's or a photo's
// address, for keys the store limits in length.

/**
 * All 64 hex digits of the text's SHA-256.
 * @param {string} text
 */
export async function hashTextInFull(text) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The first 16 hex digits of the text's SHA-256.
 * @param {string} text
 */
export const hashText = async (text) => (await hashTextInFull(text)).slice(0, 16);
