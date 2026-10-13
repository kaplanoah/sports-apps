// Node tests hand the code a fake fetch, so what they check never hangs on a server or changes with
// what it answers. Every Node test run loads this first (package.json's test script): a read that
// reaches the real fetch fails with its address, and fails the run even when the code catches it,
// as a feed reader does when a feed doesn't answer.

/** @type {string[]} */
const refusedUrls = [];

/** @param {RequestInfo | URL} input */
const readUrl = (input) => (input instanceof Request ? input.url : String(input));

globalThis.fetch = async (input) => {
  const url = readUrl(input);
  refusedUrls.push(url);
  throw new Error(`A Node test tried to read ${url}; hand the code a fake fetch instead.`);
};

process.on("exit", () => {
  if (!refusedUrls.length) return;
  console.error(
    `Node tests may not reach the network, but tried to read:\n${refusedUrls.join("\n")}`,
  );
  process.exitCode = 1;
});
