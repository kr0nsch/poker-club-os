// Time-based notifications and housekeeping.

import {
  notifications,
  outboxEvents,
  sessions,
  structureLevels,
  syncCursors,
  telegramLinkTokens,
  telegramSubscriptions,
  telegramUpdateReceipts,
  tournamentClockStates,
  tournamentRegistrations,
  tournaments,
  venues,
} from "@pcos/db";
import { deriveClock, indexOfPlayLevel } from "@pcos/domain";
import type { LateRegistrationPolicy } from "@pcos/types";
import { and, asc, eq, gt, inArray, lt, lte, or } from "drizzle-orm";
import type { CoreDeps } from "../deps.js";
import type { NotificationService } from "../notifications/notification.service.js";
import { anchorFromRow } from "../tournaments/repo.js";

export class Scheduler {
  constructor(
    private readonly deps: CoreDeps,
    private readonly notifications: NotificationService,
  ) {}

  /** TOURNAMENT_REMINDER ~2 h before start; LATE_REGISTRATION_CLOSING ~10 min before closing. */
  async reminders(): Promise<number> {
    const now = this.deps.now();
    let created = 0;
    const soon = await this.deps.db
      .select({ t: tournaments, timezone: venues.timezone })
      .from(tournaments)
      .innerJoin(venues, eq(venues.id, tournaments.venueId))
      .where(and(inArray(tournaments.status, ["SCHEDULED", "REGISTRATION_OPEN"]), gt(tournaments.startAt, now), lte(tournaments.startAt, new Date(now.getTime() + 2 * 3600_000))));
    for (const { t, timezone } of soon) {
      const regs = await this.deps.db
        .select({ playerId: tournamentRegistrations.playerId })
        .from(tournamentRegistrations)
        .where(and(eq(tournamentRegistrations.tournamentId, t.id), inArray(tournamentRegistrations.status, ["REGISTERED", "RESERVED"])));
      for (const r of regs) {
        created += await this.notifications.enqueue(this.deps.db, {
          organizationId: t.organizationId,
          type: "TOURNAMENT_REMINDER",
          playerId: r.playerId,
          payload: { tournamentId: t.id, tournamentName: t.name, startAt: t.startAt.toISOString(), timezone },
          dedupeKey: `reminder:${t.id}:${r.playerId}`,
          eventAt: t.startAt,
          channels: ["TELEGRAM", "IN_APP"],
        });
      }
    }

    const live = await this.deps.db
      .select({ t: tournaments, clock: tournamentClockStates })
      .from(tournaments)
      .innerJoin(tournamentClockStates, eq(tournamentClockStates.tournamentId, tournaments.id))
      .where(and(inArray(tournaments.status, ["RUNNING", "BREAK"]), eq(tournaments.lateRegistrationClosed, false), eq(tournamentClockStates.clockStatus, "RUNNING")));
    for (const { t, clock } of live) {
      const policy = t.lateRegistrationPolicy as LateRegistrationPolicy;
      if (!policy.enabled || policy.closeMode !== "LEVEL" || policy.untilLevel == null) continue;
      const levels = (
        await this.deps.db.select().from(structureLevels).where(eq(structureLevels.structureId, t.structureId)).orderBy(asc(structureLevels.position))
      ).map((l) => ({ type: l.type as "PLAY" | "BREAK", durationSeconds: l.durationSeconds }));
      const d = deriveClock(anchorFromRow(clock), levels, now.getTime());
      const lastIdx = indexOfPlayLevel(levels, policy.untilLevel);
      if (lastIdx < 0) continue;
      // Late registration includes the break that follows the last level.
      const closeIdx = levels[lastIdx + 1]?.type === "BREAK" ? lastIdx + 1 : lastIdx;
      if (d.levelIndex !== closeIdx) continue;
      const minutes = Math.round(d.remainingMs / 60_000);
      if (minutes > 10 || minutes < 1) continue;
      const subs = await this.deps.db
        .select({ chatId: telegramSubscriptions.telegramChatId })
        .from(telegramSubscriptions)
        .where(and(eq(telegramSubscriptions.organizationId, t.organizationId), or(eq(telegramSubscriptions.topic, `tournament:${t.id}`), eq(telegramSubscriptions.topic, "schedule"))));
      for (const s of subs) {
        created += await this.notifications.enqueue(this.deps.db, {
          organizationId: t.organizationId,
          type: "LATE_REGISTRATION_CLOSING",
          telegramChatId: s.chatId,
          channels: ["TELEGRAM"],
          payload: { tournamentId: t.id, tournamentName: t.name, minutes },
          dedupeKey: `latereg:${t.id}`,
        });
      }
    }
    return created;
  }

  /** Remove data that no longer serves any purpose. Never touches audit logs or unsynced events. */
  async housekeeping(): Promise<void> {
    const now = this.deps.now();
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
    await this.deps.db.delete(sessions).where(or(lt(sessions.expiresAt, days(7)), lt(sessions.revokedAt, days(7))));
    await this.deps.db.delete(telegramLinkTokens).where(lt(telegramLinkTokens.expiresAt, days(1)));
    await this.deps.db.delete(telegramUpdateReceipts).where(lt(telegramUpdateReceipts.receivedAt, days(30)));
    await this.deps.db.delete(notifications).where(and(inArray(notifications.status, ["SENT", "EXPIRED", "FAILED", "CANCELLED"]), lt(notifications.createdAt, days(90))));
    // Outbox rows are kept until synced (or not syncable) AND consumed by the notification fan-out.
    const [fanout] = await this.deps.db.select().from(syncCursors).where(eq(syncCursors.consumer, "notification-fanout"));
    if (fanout) {
      await this.deps.db
        .delete(outboxEvents)
        .where(and(inArray(outboxEvents.syncStatus, ["SYNCED", "SKIPPED"]), lt(outboxEvents.occurredAt, days(30)), lte(outboxEvents.seq, fanout.position)));
    }
  }
}
