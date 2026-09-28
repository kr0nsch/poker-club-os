// Notification expiry and retry policy (spec §21, §33).
// Real-time notifications lose value quickly: "your table breaks now" is
// useless 40 minutes later. Every notification type has a TTL, and expired
// messages are never sent after the WAN comes back.

import type { NotificationType } from "@pcos/types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const NOTIFICATION_TTL_MS: Record<NotificationType, number> = {
  REGISTRATION_CONFIRMED: DAY,
  REGISTRATION_CANCELLED: DAY,
  TOURNAMENT_REMINDER: 12 * HOUR,
  TOURNAMENT_CHANGED: 12 * HOUR,
  TOURNAMENT_CANCELLED: DAY,
  REGISTRATION_OPENING: 6 * HOUR,
  LATE_REGISTRATION_CLOSING: 10 * MIN,
  SEAT_ASSIGNED: 20 * MIN,
  TABLE_MOVE: 5 * MIN,
  RESULTS_FINALIZED: 7 * DAY,
  LEAGUE_POSITION_CHANGED: 3 * DAY,
  ANNOUNCEMENT: 15 * MIN,
  STAFF_ALERT: HOUR,
};

/**
 * Expiry instant. Some types are additionally bounded by an event time
 * (a reminder is pointless once the tournament has started).
 */
export function computeExpiresAt(type: NotificationType, createdAt: number, opts: { eventAt?: number | null } = {}): number {
  let expires = createdAt + NOTIFICATION_TTL_MS[type];
  if ((type === "TOURNAMENT_REMINDER" || type === "REGISTRATION_OPENING") && opts.eventAt != null) {
    expires = Math.min(expires, opts.eventAt);
  }
  return expires;
}

export function isExpired(n: { expiresAt: number | null }, now: number): boolean {
  return n.expiresAt != null && now >= n.expiresAt;
}

/**
 * Delay before the next delivery attempt. Honors a transport-provided
 * retry-after (e.g. Telegram 429 `parameters.retry_after`), otherwise
 * exponential backoff with full jitter capped at 10 minutes.
 */
export function nextAttemptDelayMs(attempt: number, retryAfterSeconds?: number | null, random: () => number = Math.random): number {
  if (retryAfterSeconds != null && retryAfterSeconds > 0) return retryAfterSeconds * 1000 + 250;
  const base = 2_000;
  const cap = 10 * MIN;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

export const MAX_DELIVERY_ATTEMPTS = 8;

export type DeliveryOutcome =
  | { kind: "sent" }
  | { kind: "retry"; retryAfterSeconds?: number | null; error: string }
  | { kind: "permanent_failure"; error: string }
  | { kind: "network_down"; error: string };

export type NextState =
  | { status: "SENT" }
  | { status: "PENDING"; nextAttemptAt: number; attemptCount: number; error?: string }
  | { status: "FAILED"; error: string }
  | { status: "EXPIRED" };

/** State transition of a notification after a delivery attempt. */
export function afterAttempt(
  n: { attemptCount: number; expiresAt: number | null },
  outcome: DeliveryOutcome,
  now: number,
  random?: () => number,
): NextState {
  if (outcome.kind === "sent") return { status: "SENT" };
  if (outcome.kind === "permanent_failure") return { status: "FAILED", error: outcome.error };
  // Network outage does not consume an attempt: the WAN monitor re-arms delivery when connectivity returns.
  const attemptCount = outcome.kind === "network_down" ? n.attemptCount : n.attemptCount + 1;
  if (attemptCount >= MAX_DELIVERY_ATTEMPTS) return { status: "FAILED", error: outcome.error };
  const delay = outcome.kind === "network_down" ? 30_000 : nextAttemptDelayMs(attemptCount, outcome.retryAfterSeconds, random);
  const nextAttemptAt = now + delay;
  if (n.expiresAt != null && nextAttemptAt >= n.expiresAt) return { status: "EXPIRED" };
  return { status: "PENDING", nextAttemptAt, attemptCount, error: outcome.error };
}
