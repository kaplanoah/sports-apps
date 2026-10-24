/**
 * A file by its own name, and the page by "page", never by an address, whose path holds the page's
 * key, so a report shared from Diagnostics can't open the page.
 * @param {string} url
 */
export function nameFile(url) {
  const name = readLastPathPart(url);
  return name.includes(".") ? name : "page";
}

/**
 * The last part of an address's path, or nothing for text that isn't an address. It catches what
 * `URL.canParse` would test, which iOS 16 lacks.
 * @param {string} url
 */
function readLastPathPart(url) {
  try {
    return new URL(url).pathname.split("/").at(-1) ?? "";
  } catch {
    return "";
  }
}

/**
 * Text with each address in it, a socket's too, named as nameFile names it.
 * @param {string} text
 */
export const hideAddresses = (text) => text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/g, nameFile);
