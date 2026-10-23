// Names and document paths in the store's HTTP and socket protocol.
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** @param {unknown} name */
export const isStoreName = (name) => typeof name === "string" && NAME_PATTERN.test(name);

/** @param {unknown} path */
export function isStoreDocumentPath(path) {
  if (typeof path !== "string") return false;
  const [collection, id, ...rest] = path.split("/");
  return isStoreName(collection) && isStoreName(id) && !rest.length;
}
