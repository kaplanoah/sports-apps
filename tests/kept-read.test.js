import test from "node:test";
import assert from "node:assert/strict";
import { keepLastRead } from "../shared/page/kept-read.js";

test("a kept read reads again only once one of its sources is another", () => {
  const reads = [];
  const readSum = keepLastRead((/** @type {number[]} */ first, /** @type {number[]} */ second) => {
    reads.push([first, second]);
    return { sum: first.length + second.length };
  });
  const first = [1, 2];
  const second = [3];

  const once = readSum(first, second);
  const again = readSum(first, second);
  const changed = readSum(first, [3]);

  assert.equal(again, once);
  assert.notEqual(changed, once);
  assert.deepEqual(changed, { sum: 3 });
  assert.equal(reads.length, 2);
});
