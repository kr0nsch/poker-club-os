// Delivery loop (spec §21, §33, §86). External requests never run inside a
// database transaction: rows are claimed (SENDING) in a short transaction,
// delivered outside it, then the outcome is recorded.

import { notifications, telegramDeliveries } from "@pcos/db";
import { afterAttempt, isExpired } from "@pcos/domain";
import type { NotificationType } from "@pcos/types";
import { and, asc, eq, lte, ne, sql } from "drizzle-orm";
import type { CoreDeps } from "../deps.js";
import { renderNotification } from "./templates.js";
import type { NotificationRow, NotificationTransport } from "./transports.js";

export interface DispatchStats {
  expired: number;
  sent: number;
  retried: number;
  failed: number;
  deferred: number;
}

export class NotificationDispatcher {
  private readonly lastByChat = new Map<string, number>();

  constructor(
    private readonly deps: CoreDeps,
    private readonly transports: Map<string, NotificationTransport>,
    private readonly wanOnline: () => boolean,
    private readonly onNetworkDown?: () => void,
  ) {}

  /** Rows left in SENDING by a crash are returned to the queue. */
  async recoverStale(): Promise<number> {
    const rows = await this.deps.db
      .update(notifications)
      .set({ status: "PENDING" })
      .where(and(eq(notifications.status, "SENDING"), lte(notifications.nextAttemptAt, new Date(this.deps.now().getTime() - 120_000))))
      .returning({ id: notifications.id });
    return rows.length;
  }

  async runOnce(limit = 50): Promise<DispatchStats> {
    const stats: DispatchStats = { expired: 0, sent: 0, retried: 0, failed: 0, deferred: 0 };
    const now = this.deps.now();

    // 1. Never deliver stale real-time messages (spec §21, §92).
    const expired = await this.deps.db
      .update(notifications)
      .set({ status: "EXPIRED", lastError: "expired before delivery" })
      .where(and(eq(notifications.status, "PENDING"), lte(notifications.expiresAt, now)))
      .returning({ id: notifications.id });
    stats.expired = expired.length;

    // 2. While the WAN is down, keep everything pending and do not hammer anyone.
    if (!this.wanOnline()) {
      const [row] = await this.deps.db
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.status, "PENDING"), ne(notifications.channel, "IN_APP")));
      stats.deferred = row?.n ?? 0;
      return stats;
    }

    // 3. Claim due rows.
    const claimed = await this.deps.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.status, "PENDING"), ne(notifications.channel, "IN_APP"), lte(notifications.nextAttemptAt, now)))
        .orderBy(asc(notifications.createdAt))
        .limit(limit)
        .for("update", { skipLocked: true });
      if (due.length === 0) return [];
      await tx
        .update(notifications)
        .set({ status: "SENDING", nextAttemptAt: now })
        .where(sql`${notifications.id} in (${sql.join(due.map((d) => sql`${d.id}`), sql`, `)})`);
      return due;
    });

    // 4. Deliver outside any transaction.
    for (let i = 0; i < claimed.length; i++) {
      const n = claimed[i]!;
      const nowMs = this.deps.now().getTime();
      if (isExpired({ expiresAt: n.expiresAt?.getTime() ?? null }, nowMs)) {
        await this.finish(n, { status: "EXPIRED" });
        stats.expired++;
        continue;
      }
      const transport = this.transports.get(n.channel);
      if (!transport) {
        await this.finish(n, { status: "FAILED", error: `no transport for ${n.channel}` });
        stats.failed++;
        continue;
      }
      await this.pace(n);
      const message = renderNotification(n.type as NotificationType, n.payload as Record<string, unknown>, (n.payload as { locale?: string }).locale);
      const result = await transport.send(n, message);
      const next = afterAttempt({ attemptCount: n.attemptCount, expiresAt: n.expiresAt?.getTime() ?? null }, result, this.deps.now().getTime());
      if (n.channel === "TELEGRAM") {
        await this.deps.db.insert(telegramDeliveries).values({
          organizationId: n.organizationId,
          notificationId: n.id,
          chatId: Number(n.recipient ?? 0),
          messageId: result.externalId != null ? Number(result.externalId) : null,
          status: result.kind === "sent" ? "SENT" : result.kind.toUpperCase(),
          error: result.kind === "sent" ? null : result.error,
          httpStatus: result.httpStatus ?? null,
        });
      }
      await this.finish(n, next);
      if (next.status === "SENT") stats.sent++;
      else if (next.status === "PENDING") stats.retried++;
      else if (next.status === "EXPIRED") stats.expired++;
      else stats.failed++;

      if (result.kind === "network_down") {
        // The WAN just went away: release the remaining claimed rows untouched and stop.
        this.onNetworkDown?.();
        const rest = claimed.slice(i + 1);
        for (const r of rest) await this.finish(r, { status: "PENDING", nextAttemptAt: r.nextAttemptAt?.getTime() ?? nowMs, attemptCount: r.attemptCount });
        stats.deferred += rest.length;
        break;
      }
    }
    return stats;
  }

  private async finish(n: NotificationRow, next: ReturnType<typeof afterAttempt> | { status: "FAILED"; error: string } | { status: "EXPIRED" }) {
    const now = this.deps.now();
    switch (next.status) {
      case "SENT":
        await this.deps.db.update(notifications).set({ status: "SENT", sentAt: now, attemptCount: n.attemptCount + 1, lastError: null }).where(eq(notifications.id, n.id));
        return;
      case "PENDING":
        await this.deps.db
          .update(notifications)
          .set({ status: "PENDING", nextAttemptAt: new Date(next.nextAttemptAt), attemptCount: next.attemptCount, lastError: "error" in next ? (next.error ?? null) : null })
          .where(eq(notifications.id, n.id));
        return;
      case "EXPIRED":
        await this.deps.db.update(notifications).set({ status: "EXPIRED", lastError: "expired before delivery" }).where(eq(notifications.id, n.id));
        return;
      case "FAILED":
        await this.deps.db.update(notifications).set({ status: "FAILED", lastError: next.error, attemptCount: n.attemptCount + 1 }).where(eq(notifications.id, n.id));
        return;
    }
  }

  /** Telegram limits: ~1 message/s per chat, ~30/s overall. */
  private async pace(n: NotificationRow) {
    const key = `${n.channel}:${n.recipient}`;
    const elapsed = Date.now() - (this.lastByChat.get(key) ?? 0);
    const wait = elapsed < 1_050 ? 1_050 - elapsed : 40;
    await new Promise((r) => setTimeout(r, wait));
    this.lastByChat.set(key, Date.now());
    if (this.lastByChat.size > 10_000) this.lastByChat.clear();
  }
}
