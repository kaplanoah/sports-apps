/**
 * Where the feed keeper keeps a feed's answer to a request in its storage.
 * @param {string} name the feed's
 * @param {string} key the request
 */
export async function nameKeptFeedKey(name, key) {
  const text = new TextEncoder().encode(`${name} ${key}`);
  const digest = await crypto.subtle.digest("SHA-256", text);
  return Buffer.from(digest).subarray(0, 16).toString("hex");
}
