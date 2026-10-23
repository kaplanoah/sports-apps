// A stand-in for the page's store client: a read answers with what's stored, fails for a path in
// `unreadable`, or waits while the test holds it, a watch answers once the test moves on, and the
// test can change a document and tell its watchers.

/**
 * @param {Record<string, any>} documents
 * @param {{ unreadable?: string[] }} [options]
 */
export function createFakeStore(documents, { unreadable = [] } = {}) {
  /** @type {Record<string, { onNext: (snapshot: any) => void }>} */
  const watchers = {};
  /** @type {Record<string, Promise<void>>} */
  const held = {};
  /** @param {string} path */
  const readStored = (path) => ({
    id: path.split("/").pop(),
    exists: path in documents,
    data: () => documents[path],
  });
  const store = {
    /** @param {string} path */
    doc: (path) => ({
      get: async () => {
        await held[path];
        if (unreadable.includes(path)) throw new Error("unreadable");
        return readStored(path);
      },
      /**
       * @param {(snapshot: any) => void} onNext
       * @param {(error: Error) => void} [onError]
       */
      onSnapshot: (onNext, onError = () => {}) => {
        watchers[path] = { onNext };
        queueMicrotask(() =>
          unreadable.includes(path) ? onError(new Error("unreadable")) : onNext(readStored(path)),
        );
        return () => delete watchers[path];
      },
    }),
    /** @param {string} name */
    collection: (name) => ({
      limit: () => ({
        get: async () => ({
          docs: Object.keys(documents)
            .filter((path) => path.startsWith(`${name}/`))
            .map(readStored),
        }),
        onSnapshot: () => () => {},
      }),
    }),
  };
  /**
   * Changes a document, or takes it out with `undefined`, and tells its watcher.
   * @param {string} path
   * @param {any} data
   */
  const deliver = (path, data) => {
    if (data === undefined) delete documents[path];
    else documents[path] = data;
    watchers[path]?.onNext(readStored(path));
  };
  /**
   * Holds each read of a path until the returned function lets it go.
   * @param {string} path
   */
  const holdReads = (path) => {
    /** @type {() => void} */
    let release = () => {};
    held[path] = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    return () => {
      delete held[path];
      release();
    };
  };
  return { store, deliver, holdReads };
}
