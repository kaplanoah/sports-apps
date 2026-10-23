import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { followHandoff } from "./browser/page-move.mjs";

const PAGE_HOST = "sports.example";
const DESTINATION = `https://${PAGE_HOST}/?carried=fixture`;
const ERROR_DOCUMENT = "chrome-error://chromewebdata/";

function createGate() {
  let release;
  const promise = new Promise((resolve) => {
    release = () => resolve(null);
  });
  return { promise, release };
}

function createHandoff() {
  const events = new EventEmitter();
  let frameAddress = "about:blank";
  const frame = { url: () => frameAddress };
  const visits = [];
  const headers = createGate();
  const finished = createGate();
  const response = {
    headers: () => ({ location: DESTINATION }),
    url: () => `https://${PAGE_HOST}/access/handoff?token=fixture`,
    finished: () => finished.promise,
  };
  const stub = Object.assign(events, {
    mainFrame: () => frame,
    waitForResponse: async (pattern) => {
      assert.equal(pattern, `https://${PAGE_HOST}/access/handoff?**`);
      await headers.promise;
      return response;
    },
    goto: async (address) => {
      visits.push(address);
    },
  });
  const page = /** @type {import("@playwright/test").Page} */ (/** @type {unknown} */ (stub));
  const commit = (address, isMainFrame = true) => {
    frameAddress = address;
    events.emit("framenavigated", isMainFrame ? frame : { url: () => address });
  };
  const leave = async () => {
    headers.release();
    finished.release();
  };
  return { page, stub, events, visits, response, headers, commit, leave };
}

for (const address of [DESTINATION, ERROR_DOCUMENT]) {
  test(`handoff headers and response completion cannot bypass the gated commit: ${address}`, async () => {
    const handoff = createHandoff();
    const gate = createGate();
    const commit = gate.promise.then(() => handoff.commit(address));
    const following = followHandoff(handoff.page, PAGE_HOST, handoff.leave);
    try {
      await handoff.headers.promise;
      await handoff.response.finished();
      await setImmediate();
      assert.deepEqual(handoff.visits, [], "goto must wait for the original document to commit");
    } finally {
      gate.release();
      await commit;
      await following;
    }
    assert.deepEqual(handoff.visits, [DESTINATION]);
    assert.equal(handoff.events.listenerCount("framenavigated"), 0);
  });

  test(`observer captures a commit during departure before headers: ${address}`, async () => {
    const handoff = createHandoff();
    const following = followHandoff(handoff.page, PAGE_HOST, async () => {
      assert.equal(handoff.events.listenerCount("framenavigated"), 1);
      handoff.commit(address);
      await handoff.leave();
    });
    assert.equal((await following).href, DESTINATION);
    assert.deepEqual(handoff.visits, [DESTINATION]);
    assert.equal(handoff.events.listenerCount("framenavigated"), 0);
  });
}

for (const [address, isMainFrame] of /** @type {const} */ ([
  ["https://old.sports.example/", true],
  [`https://${PAGE_HOST}/access/handoff?token=fixture`, true],
  ["about:blank", true],
  [DESTINATION, false],
  [ERROR_DOCUMENT, false],
])) {
  test(`ignores an unrelated commit: ${address}, main frame ${isMainFrame}`, async () => {
    const handoff = createHandoff();
    const following = followHandoff(handoff.page, PAGE_HOST, handoff.leave);
    try {
      await handoff.headers.promise;
      handoff.commit(address, isMainFrame);
      await setImmediate();
      assert.deepEqual(handoff.visits, [], "an unrelated document must not open the commit gate");
    } finally {
      handoff.commit(ERROR_DOCUMENT);
      await following;
    }
    assert.deepEqual(handoff.visits, [DESTINATION]);
  });
}

for (const stage of ["departure", "response", "location", "goto"]) {
  test(`removes the commit listener when ${stage} fails`, async () => {
    const handoff = createHandoff();
    const failure = new Error(`${stage} failed`);
    let leave = handoff.leave;
    if (stage === "departure") {
      leave = async () => {
        throw failure;
      };
    } else if (stage === "response") {
      handoff.stub.waitForResponse = async () => {
        throw failure;
      };
    } else if (stage === "location") {
      handoff.response.headers = () => {
        throw failure;
      };
    } else {
      handoff.stub.goto = async () => {
        throw failure;
      };
      leave = async () => {
        handoff.commit(ERROR_DOCUMENT);
        await handoff.leave();
      };
    }
    await assert.rejects(followHandoff(handoff.page, PAGE_HOST, leave), failure);
    assert.equal(handoff.events.listenerCount("framenavigated"), 0);
    assert.deepEqual(handoff.visits, []);
  });
}
