import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  afterAttempt,
  computeExpiresAt,
  decideInbound,
  isExpired,
  MAX_DELIVERY_ATTEMPTS,
  nextAttemptDelayMs,
  NOTIFICATION_TTL_MS,
  takeBatch,
} from "../src/index.js";

const now = Date.UTC(2026, 8, 27, 20);
const MIN = 60_000;

describe("notification expiry (spec §21)", () => {
  it("real-time notifications expire quickly, informational ones later", () => {
    expect(NOTIFICATION_TTL_MS.TABLE_MOVE).toBeLessThanOrEqual(5 * MIN);
    expect(NOTIFICATION_TTL_MS.RESULTS_FINALIZED).toBeGreaterThan(NOTIFICATION_TTL_MS.TABLE_MOVE * 100);
  });

  it("a table-break notification created 40 minutes ago is expired", () => {
    const n = { expiresAt: computeExpiresAt("TABLE_MOVE", now - 40 * MIN) };
    expect(isExpired(n, now)).toBe(true);
  });

  it("'tournament starts tomorrow' survives a short WAN outage", () => {
    const startAt = now + 20 * 3600_000;
    const n = { expiresAt: computeExpiresAt("TOURNAMENT_REMINDER", now - 40 * MIN, { eventAt: startAt }) };
    expect(isExpired(n, now)).toBe(false);
  });

  it("reminders never outlive the event", () => {
    expect(computeExpiresAt("TOURNAMENT_REMINDER", now, { eventAt: now + MIN })).toBe(now + MIN);
  });
});

describe("delivery retries (spec §33)", () => {
  it("honours retry_after", () => {
    expect(nextAttemptDelayMs(1, 7)).toBe(7250);
  });

  it("backs off exponentially with a cap", () => {
    const d = (a: number) => nextAttemptDelayMs(a, null, () => 1);
    expect(d(1)).toBe(2000);
    expect(d(2)).toBe(4000);
    expect(d(3)).toBe(8000);
    expect(d(30)).toBe(10 * MIN);
  });

  it("does not burn attempts while the network is down", () => {
    const next = afterAttempt({ attemptCount: 2, expiresAt: now + 3600_000 }, { kind: "network_down", error: "ENETUNREACH" }, now);
    expect(next).toMatchObject({ status: "PENDING", attemptCount: 2 });
  });

  it("expires instead of retrying past the deadline", () => {
    const next = afterAttempt({ attemptCount: 1, expiresAt: now + 1000 }, { kind: "retry", error: "500" }, now, () => 1);
    expect(next).toEqual({ status: "EXPIRED" });
  });

  it("fails permanently after the maximum attempts", () => {
    const next = afterAttempt({ attemptCount: MAX_DELIVERY_ATTEMPTS - 1, expiresAt: null }, { kind: "retry", error: "500" }, now);
    expect(next.status).toBe("FAILED");
  });
});

describe("edge-cloud sync decisions (spec §8)", () => {
  const change = { entityType: "player", entityId: "p1", remoteVersion: 5, baseVersion: 4, originNodeId: "cloud" };
  const local = { exists: true, version: 4, lastSyncedVersion: 4, lockedByLiveOperation: false };

  it("applies non-conflicting changes", () => {
    expect(decideInbound(change, local, "edge-1")).toEqual({ action: "APPLY" });
    expect(decideInbound(change, { ...local, exists: false }, "edge-1")).toEqual({ action: "APPLY" });
  });

  it("skips echoes and already-applied versions", () => {
    expect(decideInbound({ ...change, originNodeId: "edge-1" }, local, "edge-1").action).toBe("SKIP");
    expect(decideInbound({ ...change, remoteVersion: 3 }, { ...local, version: 4, lastSyncedVersion: 4 }, "edge-1").action).toBe("SKIP");
  });

  it("records a conflict when both sides changed", () => {
    expect(decideInbound(change, { ...local, version: 6, lastSyncedVersion: 4 }, "edge-1").action).toBe("CONFLICT");
  });

  it("never lets the cloud mutate a live tournament", () => {
    expect(decideInbound(change, { ...local, lockedByLiveOperation: true }, "edge-1").action).toBe("REJECT");
  });

  it("batches in sequence order within limits", () => {
    const items = [5, 1, 3, 2, 4].map((seq) => ({ seq, sizeBytes: 400 }));
    expect(takeBatch(items, 10, 1000).map((i) => i.seq)).toEqual([1, 2]);
    expect(takeBatch([{ seq: 1, sizeBytes: 5000 }], 10, 1000)).toHaveLength(1);
  });

  it("advances the cursor only over a contiguous acknowledged prefix", () => {
    expect(advanceCursor(10, [11, 12, 13], new Set([11, 13]))).toBe(11);
    expect(advanceCursor(10, [11, 12, 13], new Set([11, 12, 13]))).toBe(13);
    expect(advanceCursor(10, [11, 12], new Set())).toBe(10);
  });
});
