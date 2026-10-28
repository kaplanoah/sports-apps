import { respondJson } from "../../../../shared/worker/responses.js";
import { hashTextInFull } from "../../../../shared/worker/hash-text.js";
import { readContactDelivery, sendContactMail } from "./mail.js";

const HOUR_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const DELIVERY_CHECK_MS = 15 * 60 * 1000;
const CHUNK_CHARACTERS = 16000;
const SENDER_REPORTS_PER_HOUR = 5;
const PENDING_REPORTS_PER_APP = 100;
// Resend forgets idempotency keys after 24 hours; an uncertain send must stop before then.
const SAFE_RETRY_MS = 23 * HOUR_MS;
const DELIVERY_WAIT_MS = 7 * 24 * HOUR_MS;
// Long enough for the Watch apps workflow to raise its issue and the owner to read the provider's logs.
const PAUSED_KEEP_MS = 7 * 24 * HOUR_MS;
// A Durable Object deletes at most this many keys in one call.
const DELETE_BATCH_KEYS = 128;

/** @param {string} id @param {number} index */
const namePayloadChunk = (id, index) => `payload:${id}:${index}`;

/** @param {string} id @param {number} count */
const listChunkKeys = (id, count) =>
  Array.from({ length: count }, (_, index) => namePayloadChunk(id, index));

/** @param {any} storage @param {string[]} keys */
async function deleteKeys(storage, keys) {
  for (let start = 0; start < keys.length; start += DELETE_BATCH_KEYS)
    await storage.delete(keys.slice(start, start + DELETE_BATCH_KEYS));
}

export class EmailOutbox {
  /** @param {any} ctx @param {any} env @param {{ now?: () => number, fetchImpl?: typeof fetch }} [options] */
  constructor(ctx, env, { now = Date.now, fetchImpl = fetch } = {}) {
    this.ctx = ctx;
    this.storage = ctx.storage;
    this.env = env;
    this.now = now;
    this.fetchImpl = fetchImpl;
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/status") return this.readStatus();
    if (url.pathname !== "/submit" || request.method !== "POST")
      return new Response(null, { status: 404 });
    const { submission, sender } = await request.json();
    return this.ctx.blockConcurrencyWhile(() => this.acceptSubmission(submission, sender));
  }

  /** @param {any} submission @param {string} sender */
  async acceptSubmission(submission, sender) {
    const fingerprint = await hashTextInFull(JSON.stringify(submission));
    const id = `${submission.app}/${submission.id}`;
    return this.storage.transaction(async (storage) => {
      const receiptKey = `receipt:${id}`;
      const receipt = await storage.get(receiptKey);
      if (receipt)
        return respondJson(
          { id: submission.id, accepted: receipt.fingerprint === fingerprint },
          receipt.fingerprint === fingerprint ? 200 : 409,
        );
      const pending = await storage.list({ prefix: "pending:" });
      const rateKey = `sender:${submission.app}:${sender}`;
      const previous = await storage.get(rateKey);
      const rate =
        previous?.until > this.now() ? previous : { count: 0, until: this.now() + HOUR_MS };
      const appPending = [...pending.values()].filter(
        (report) => report.app === submission.app && report.state !== "attention",
      );
      if (rate.count >= SENDER_REPORTS_PER_HOUR || appPending.length >= PENDING_REPORTS_PER_APP)
        return respondJson({ problem: "busy" }, 429);
      const text = JSON.stringify({
        ...submission,
        from: this.env.CONTACT_FROM,
        to: this.env.CONTACT_TO,
      });
      const chunks = Math.ceil(text.length / CHUNK_CHARACTERS);
      for (let index = 0; index < chunks; index += 1)
        await storage.put(
          namePayloadChunk(id, index),
          text.slice(index * CHUNK_CHARACTERS, (index + 1) * CHUNK_CHARACTERS),
        );
      await storage.put(receiptKey, { fingerprint });
      await storage.put(`pending:${id}`, {
        id,
        app: submission.app,
        chunks,
        createdAt: this.now(),
        nextAt: this.now(),
        attempts: 0,
        providerId: null,
        firstAttemptAt: null,
        state: "queued",
      });
      await storage.put(rateKey, { ...rate, count: rate.count + 1 });
      const alarm = await storage.getAlarm();
      if (alarm === null || alarm > this.now() + 1000) await storage.setAlarm(this.now() + 1000);
      return respondJson({ id: submission.id, accepted: true }, 202);
    });
  }

  async readStatus() {
    const pending = await this.storage.list({ prefix: "pending:" });
    const needsAttention = [...pending.values()].some(
      (report) => report.state === "attention" || this.now() - report.createdAt > HOUR_MS,
    );
    return respondJson({ ok: !needsAttention });
  }

  /** @param {any} report */
  async readSubmission(report) {
    const keys = listChunkKeys(report.id, report.chunks);
    const chunks = await Promise.all(keys.map((key) => this.storage.get(key)));
    if (chunks.some((chunk) => typeof chunk !== "string")) throw new Error("missing-payload");
    return JSON.parse(chunks.join(""));
  }

  /** @param {any} report @param {string} state */
  async finishDelivery(report, state) {
    await this.storage.transaction(async (storage) => {
      await deleteKeys(storage, listChunkKeys(report.id, report.chunks));
      if (state === "delivered") await storage.delete(`pending:${report.id}`);
      else
        await storage.put(`pending:${report.id}`, {
          ...report,
          state: "attention",
          nextAt: this.now() + PAUSED_KEEP_MS,
        });
    });
  }

  /** @param {any} report */
  async processReport(report) {
    if (report.state === "attention") return this.storage.delete(`pending:${report.id}`);
    const isExpired = report.providerId
      ? this.now() - report.createdAt >= DELIVERY_WAIT_MS
      : report.firstAttemptAt !== null && this.now() - report.firstAttemptAt >= SAFE_RETRY_MS;
    if (isExpired) return this.finishDelivery(report, "attention");
    report.firstAttemptAt ??= this.now();
    report.attempts += 1;
    report.nextAt =
      this.now() +
      (report.providerId
        ? DELIVERY_CHECK_MS
        : Math.min(HOUR_MS, RETRY_MS * 2 ** Math.min(report.attempts - 1, 6)));
    await this.storage.put(`pending:${report.id}`, report);
    // Persist the next wake before the external call, including when execution stops mid-request.
    await this.storage.setAlarm(this.now() + RETRY_MS);
    try {
      if (!report.providerId) {
        const submission = await this.readSubmission(report);
        const env = { ...this.env, CONTACT_FROM: submission.from, CONTACT_TO: submission.to };
        report.providerId = await sendContactMail(submission, env, this.fetchImpl);
        report.state = "accepted-by-provider";
        report.nextAt = this.now() + DELIVERY_CHECK_MS;
        await this.storage.put(`pending:${report.id}`, report);
      } else {
        const state = await readContactDelivery(report.providerId, this.env, this.fetchImpl);
        if (["delivered", "opened", "clicked"].includes(state))
          await this.finishDelivery(report, "delivered");
        else if (["bounced", "complained", "failed", "suppressed"].includes(state))
          await this.finishDelivery(report, state);
      }
    } catch {
      // Payloads stay private in storage; provider errors can contain addresses and message text.
    }
  }

  async alarm() {
    const pending = await this.storage.list({ prefix: "pending:" });
    const report = [...pending.values()].sort((first, second) => first.nextAt - second.nextAt)[0];
    if (report && report.nextAt <= this.now()) await this.processReport(report);
    await this.removeExpiredSenders();
    await this.scheduleNextWake();
  }

  async removeExpiredSenders() {
    const senders = await this.storage.list({ prefix: "sender:" });
    const expired = [...senders].filter(([, rate]) => rate.until <= this.now());
    await deleteKeys(
      this.storage,
      expired.map(([key]) => key),
    );
  }

  async scheduleNextWake() {
    const pending = await this.storage.list({ prefix: "pending:" });
    const senders = await this.storage.list({ prefix: "sender:" });
    const times = [
      ...[...pending.values()].map((report) => report.nextAt),
      ...[...senders.values()].map((rate) => rate.until),
    ];
    if (times.length) await this.storage.setAlarm(Math.max(this.now() + 1000, Math.min(...times)));
  }
}
