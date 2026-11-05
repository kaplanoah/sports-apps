// Node tests hand the code a fake fetch, so what they check never hangs on a server or changes with
// what it answers. Every Node test run loads this first (package.json's test script): a read that
// reaches the real fetch fails with its address, and fails the run even when the code catches it,
// as a feed reader does when a feed doesn't answer.

/** @type {string[]} */
const refusedUrls = [];

/** @param {RequestInfo | URL} input */
const readUrl = (input) => (input instanceof Request ? input.url : String(input));

/** @returns {string} */
const describeRefusedUrls = () =>
  `Node tests may not reach the network, but tried to read:\n${refusedUrls.join("\n")}`;

globalThis.fetch = async (input) => {
  const url = readUrl(input);
  refusedUrls.push(url);
  throw new Error(`A Node test tried to read ${url}; hand the code a fake fetch instead.`);
};

// The dot reporter hides a test file's stderr, so under the runner the refused addresses also fail
// the file as a test, where the reporter prints the failure's message. A read refused after the
// file's tests finish fails the run without its address, which only stderr carries. Only the runner's
// own files load node:test, which changes the exit code of any process that imports it.
if (process.env.NODE_TEST_CONTEXT) {
  const { after } = await import("node:test");
  after(() => {
    if (refusedUrls.length) throw new Error(describeRefusedUrls());
  });
}

process.on("exit", () => {
  if (!refusedUrls.length) return;
  console.error(describeRefusedUrls());
  process.exitCode = 1;
});
