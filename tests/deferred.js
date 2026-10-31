export function createDeferred() {
  let resolve;
  const promise = new Promise((answer) => {
    resolve = answer;
  });
  return { promise, resolve };
}
