import assert from "node:assert/strict";
import { EmailOutbox } from "../worker/src/outbox.js";

/** @param {any} submission */
export function createTestOutbox(submission) {
  const values = new Map();
  const clock = { now: 1000000 };
  const calls = [];
  let alarm = null;
  let provider = async () => Response.json({ id: "provider-id" });
  let rejectedWrites = false;
  let rejectedAlarms = false;
  const storage = {
    get: async (key) => structuredClone(values.get(key)),
    put: async (key, value) => {
      if (rejectedWrites) throw new Error("storage-full");
      assert.ok(new TextEncoder().encode(JSON.stringify(value)).byteLength < 128 * 1024);
      values.set(key, structuredClone(value));
    },
    delete: async (keys) => {
      if (Array.isArray(keys)) assert.ok(keys.length <= 128, "a delete takes at most 128 keys");
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    list: async ({ prefix }) =>
      new Map(
        [...values]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key, structuredClone(value)]),
      ),
    getAlarm: async () => alarm,
    setAlarm: async (at) => {
      if (rejectedAlarms) throw new Error("alarm-failed");
      alarm = at;
    },
    transaction: async (work) => {
      const before = structuredClone(values);
      const beforeAlarm = alarm;
      try {
        return await work(storage);
      } catch (error) {
        values.clear();
        for (const [key, value] of before) values.set(key, value);
        alarm = beforeAlarm;
        throw error;
      }
    },
  };
  let previous = Promise.resolve();
  const ctx = {
    storage,
    blockConcurrencyWhile: (work) => {
      const next = previous.then(work);
      previous = next.catch(() => {});
      return next;
    },
  };
  const env = {
    CONTACT_FROM: "reports@example.com",
    CONTACT_TO: "owner@example.com",
    CONTACT_MAIL_KEY: "key",
  };
  const options = {
    now: () => clock.now,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return provider();
    },
  };
  const outbox = new EmailOutbox(ctx, env, options);
  const submit = (report = submission, sender = "hashed-sender") =>
    outbox.fetch(
      new Request("https://contact/submit", {
        method: "POST",
        body: JSON.stringify({ submission: report, sender }),
      }),
    );
  const wake = async () => {
    clock.now = Math.max(clock.now, alarm);
    alarm = null;
    await outbox.alarm();
  };
  return {
    values,
    calls,
    clock,
    ctx,
    env,
    options,
    outbox,
    submit,
    wake,
    setProvider: (next) => {
      provider = next;
    },
    rejectWrites: () => {
      rejectedWrites = true;
    },
    rejectAlarms: () => {
      rejectedAlarms = true;
    },
  };
}
