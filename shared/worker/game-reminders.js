// Pregame deadlines and receipts share the season store's alarm and private device records.
import { isSameJson } from "../page/compare.js";
import { readNotificationPreferences } from "../page/notification-preferences.js";
import { formatReminderTime } from "../page/days.js";

const FACTS_KEY = "push:reminder-games";
const VERIFY_AHEAD_MS = 30_000;
const FRESH_FOR_MS = 60_000;
const RETRY_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** @param {any} game @param {any} preferences */
export function describeGameReminder(game, preferences) {
  const when =
    preferences.minutes === 0
      ? "now"
      : `at ${formatReminderTime(game.start, preferences.timeZone)}`;
  const network = game.networks.length ? `on ${game.networks.join(", ")}` : "network not announced";
  return {
    title: `${game.away} @ ${game.home} starting ${when} ${network}`,
    body: "",
    tag: `game-reminder:${game.id}`,
    game: game.id,
    season: game.season,
  };
}

/** @param {any} game @param {any} preferences */
function describeDeadline(game, preferences) {
  const dueAt = game.start - preferences.minutes * 60_000;
  const expiresAt =
    preferences.minutes === 0 ? dueAt + 60_000 : Math.min(game.start, dueAt + 120_000);
  return { dueAt, expiresAt };
}

function isDeliveryFinished(receipt) {
  return (
    receipt?.state === "sent" ||
    receipt?.attempts >= MAX_ATTEMPTS ||
    (receipt?.state !== "pending" && receipt?.uncertain)
  );
}

/** @param {any} device @param {any[]} games @param {number} now */
function planDevice(device, games, now) {
  const preferences = readNotificationPreferences(device);
  const receipts = Object.fromEntries(
    Object.entries(device.reminderReceipts ?? {}).filter(
      ([, receipt]) => now - /** @type {any} */ (receipt).dueAt < RECEIPT_RETENTION_MS,
    ),
  );
  const ids = new Set(games.map((game) => game.id));
  for (const [id, receipt] of Object.entries(receipts)) {
    if (receipt.state === "pending" && (!preferences.reminders || !ids.has(id))) {
      if (receipt.attempts > 0) receipts[id] = { ...receipt, state: "expired" };
      else delete receipts[id];
    }
  }
  if (!preferences.reminders) return { ...device, reminderReceipts: receipts };
  for (const game of games) {
    const previous = receipts[game.id];
    if (isDeliveryFinished(previous)) continue;
    const deadline = describeDeadline(game, preferences);
    const changed = !previous || previous.dueAt !== deadline.dueAt;
    if (changed) {
      if (previous?.uncertain) {
        receipts[game.id] = { ...previous, state: "expired" };
        continue;
      }
      receipts[game.id] = {
        ...deadline,
        state: deadline.dueAt <= now ? "skipped" : "pending",
        attempts: previous?.attempts ?? 0,
        nextAt: deadline.dueAt,
      };
    }
  }
  return { ...device, reminderReceipts: receipts };
}

/** @param {{ storage: any, push: ReturnType<typeof import("./push.js").createPushService>, now: () => number, verify: () => Promise<void> }} options */
export function createGameReminders({ storage, push, now, verify }) {
  let checking = null;

  async function saveGames(games, verified = false) {
    if (games === null) {
      const previous = await storage.get(FACTS_KEY);
      if (previous) await storage.put(FACTS_KEY, { ...previous, verifiedAt: null });
      return;
    }
    await storage.put(FACTS_KEY, { games, verifiedAt: verified ? now() : null });
    await planDevices(games);
  }

  async function planDevices(games) {
    const devices = await push.listSubscriptions();
    for (const [key] of devices)
      await push.updateDevice(key, (device) => {
        const planned = planDevice(device, games, now());
        return isSameJson(device, planned) ? null : planned;
      });
  }

  async function refreshDevices() {
    const facts = await storage.get(FACTS_KEY);
    if (facts) await planDevices(facts.games);
  }

  async function findNextDeadline() {
    const facts = await storage.get(FACTS_KEY);
    const devices = await push.listSubscriptions();
    let nextAt = Infinity;
    for (const device of devices.values()) {
      if (!readNotificationPreferences(device).reminders) continue;
      for (const receipt of Object.values(device.reminderReceipts ?? {})) {
        if (receipt.state !== "pending" || receipt.expiresAt <= now()) continue;
        const verifyAt = receipt.dueAt - VERIFY_AHEAD_MS;
        const isVerified = facts?.verifiedAt !== null && facts?.verifiedAt >= verifyAt;
        nextAt = Math.min(nextAt, isVerified ? receipt.nextAt : Math.min(verifyAt, receipt.nextAt));
      }
    }
    return nextAt;
  }

  async function deliverDue() {
    let facts = await storage.get(FACTS_KEY);
    if (!facts || (await findNextDeadline()) > now()) return;
    const isFresh = facts.verifiedAt !== null && now() - facts.verifiedAt <= FRESH_FOR_MS;
    if (!isFresh) {
      try {
        await verify();
      } catch {
        await saveGames(null);
      }
      facts = await storage.get(FACTS_KEY);
    }
    if (facts?.verifiedAt === null || !facts) return;
    const games = new Map(facts.games.map((game) => [game.id, game]));
    const devices = await push.listSubscriptions();
    await Promise.allSettled(
      [...devices].map(async ([key, device]) => {
        for (const id of Object.keys(device.reminderReceipts ?? {}))
          await deliverGame(key, id, games);
      }),
    );
    await refreshDevices();
  }

  async function deliverGame(key, id, games) {
    let claimed = null;
    await push.updateDevice(key, (device) => {
      const receipt = device.reminderReceipts?.[id];
      const preferences = readNotificationPreferences(device);
      const game = games.get(id);
      if (!preferences.reminders || !game || receipt?.state !== "pending" || receipt.nextAt > now())
        return null;
      if (receipt.expiresAt <= now() || receipt.attempts >= MAX_ATTEMPTS) {
        return {
          ...device,
          reminderReceipts: { ...device.reminderReceipts, [id]: { ...receipt, state: "expired" } },
        };
      }
      const attempt = {
        ...receipt,
        attempts: receipt.attempts + 1,
        uncertain: true,
        nextAt: now() + RETRY_MS * (receipt.attempts + 1),
      };
      claimed = { device, receipt: attempt, preferences, game };
      // Persist before the network request; a lost response retries with the same notification tag.
      return { ...device, reminderReceipts: { ...device.reminderReceipts, [id]: attempt } };
    });
    if (!claimed) return;
    const { device, receipt, preferences, game } = claimed;
    let status = 503;
    let uncertain = true;
    try {
      ({ status } = await push.deliver(
        key,
        device,
        describeGameReminder(game, preferences),
        Math.max(0, Math.floor((receipt.expiresAt - now()) / 1000)),
      ));
      uncertain = false;
    } catch {
      /* The persisted attempt bounds a retry after an uncertain response. */
    }
    const state =
      status >= 200 && status < 300
        ? "sent"
        : (status === 429 || status >= 500) && receipt.attempts < MAX_ATTEMPTS
          ? "pending"
          : "expired";
    await push.updateDevice(key, (current) => {
      const latest = current.reminderReceipts?.[id];
      if (latest?.attempts !== receipt.attempts) return null;
      const nextState = latest.state !== "pending" && state !== "sent" ? latest.state : state;
      return {
        ...current,
        reminderReceipts: {
          ...current.reminderReceipts,
          [id]: { ...latest, uncertain, state: nextState },
        },
      };
    });
  }

  function checkDue() {
    checking ??= deliverDue().finally(() => {
      checking = null;
    });
    return checking;
  }

  return { saveGames, refreshDevices, findNextDeadline, checkDue };
}
